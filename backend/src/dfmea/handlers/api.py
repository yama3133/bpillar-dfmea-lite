"""REST API (API Gateway proxy integration, Cognito authorizer)."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any

from botocore.exceptions import ClientError

from .. import aws, config, i18n
from ..events import emit, list_events
from ..ontology import queries as q
from ..ontology.store import OntologyStore
from .workflow import get_findings, rpn

log = logging.getLogger(__name__)
MAX_SCENARIO = 2000


class HttpError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _cors(event: dict[str, Any]) -> dict[str, str]:
    allowed = [o for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o]
    origin = (event.get("headers") or {}).get("origin") or (event.get("headers") or {}).get("Origin")
    if origin and origin in allowed:
        return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
    return {}


def _resp(event: dict[str, Any], status: int, body: Any) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **_cors(event)},
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


def _sub(event: dict[str, Any]) -> str:
    sub = (((event.get("requestContext") or {}).get("authorizer") or {}).get("claims") or {}).get("sub")
    if not sub:
        raise HttpError(401, "Unauthorized")
    return sub


def _body(event: dict[str, Any]) -> dict[str, Any]:
    try:
        b = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError as e:
        raise HttpError(400, "invalid JSON") from e
    if not isinstance(b, dict):
        raise HttpError(400, "body must be an object")
    return b


def _owned_meta(review_id: str, sub: str) -> dict[str, Any]:
    item = aws.reviews().get_item(Key={"reviewId": review_id, "sk": "META"}).get("Item")
    if not item or item.get("userSub") != sub:
        raise HttpError(404, "Not found")
    return item


def _latest_store() -> OntologyStore:
    return OntologyStore.from_s3(aws.s3(), config.ontology_bucket(), config.ontology_key())


def create_review(event: dict[str, Any], sub: str) -> tuple[int, Any]:
    b = _body(event)
    rid, comp, scenario = b.get("reviewId", ""), b.get("componentIri", ""), b.get("scenario", "")
    language = b.get("language", i18n.DEFAULT_LANGUAGE)
    try:
        u = uuid.UUID(str(rid))
    except ValueError as e:
        raise HttpError(400, "reviewId must be a UUIDv4") from e
    if u.version != 4 or str(u) != rid:
        raise HttpError(400, "reviewId must be a canonical UUIDv4")
    if not isinstance(scenario, str) or not scenario.strip() or len(scenario) > MAX_SCENARIO:
        raise HttpError(400, f"scenario must be 1-{MAX_SCENARIO} chars")
    if not i18n.is_supported(language):
        raise HttpError(400, f"language must be one of {'|'.join(i18n.LANGUAGES)}")
    if comp not in {c["iri"] for c in q.list_components(_latest_store())}:
        raise HttpError(400, "unknown componentIri")
    now = int(time.time())
    try:
        aws.reviews().put_item(
            Item={"reviewId": rid, "sk": "META", "userSub": sub, "componentIri": comp, "scenario": scenario,
                  "language": language, "status": "ACCEPTED", "seq": 0, "createdAt": now, "updatedAt": now, "ttl": now + config.TTL_SECONDS},
            ConditionExpression="attribute_not_exists(reviewId)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HttpError(409, "reviewId already exists") from e
        raise
    emit(rid, "review.accepted", {"componentIri": comp, "scenario": scenario, "language": language})
    ex = aws.sfn().start_execution(
        stateMachineArn=os.environ["STATE_MACHINE_ARN"], name=rid, input=json.dumps({"reviewId": rid})
    )
    return 202, {"reviewId": rid, "executionArn": ex["executionArn"]}


def get_review(review_id: str, sub: str) -> tuple[int, Any]:
    meta = aws.from_ddb(_owned_meta(review_id, sub))
    meta.pop("taskToken", None)
    findings = get_findings(review_id)
    for f in findings:
        f["rpn"] = rpn(f)
    accepted = sorted([f for f in findings if f.get("validation", {}).get("status") == "accepted"],
                      key=lambda f: (-f["rpn"], f["finding_id"]))
    rejected = [f for f in findings if f.get("validation", {}).get("status") == "rejected"]
    pending = [f for f in findings if "validation" not in f]
    return 200, {"review": meta, "findings": {"accepted": accepted, "rejected": rejected, "pending": pending}}


def get_events(event: dict[str, Any], review_id: str, sub: str) -> tuple[int, Any]:
    _owned_meta(review_id, sub)
    qs = event.get("queryStringParameters") or {}
    try:
        after = max(0, int(qs.get("after", "0")))
    except ValueError as e:
        raise HttpError(400, "after must be an integer") from e
    return 200, {"events": list_events(review_id, after)}


def decide(event: dict[str, Any], review_id: str, sub: str, claims: dict[str, Any]) -> tuple[int, Any]:
    b = _body(event)
    decision, comment = b.get("decision"), b.get("comment", "")
    if decision not in ("approve", "reject"):
        raise HttpError(400, "decision must be approve|reject")
    if not isinstance(comment, str) or len(comment) > 1000:
        raise HttpError(400, "comment must be a string up to 1000 chars")
    by = claims.get("email") or claims.get("cognito:username") or sub
    rec = {"decision": decision, "comment": comment, "by": by, "at": int(time.time())}
    try:
        old = aws.reviews().update_item(
            Key={"reviewId": review_id, "sk": "META"},
            UpdateExpression="SET #s = :decided, decision = :rec REMOVE taskToken",
            ConditionExpression="userSub = :sub AND #s = :waiting AND attribute_exists(taskToken)",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":decided": "HITL_DECIDED", ":rec": rec, ":sub": sub,
                                       ":waiting": "WAITING_HITL"},
            ReturnValues="ALL_OLD",
        )["Attributes"]
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        _owned_meta(review_id, sub)  # 404 when missing / not owner
        raise HttpError(409, "review is not waiting for a decision") from e
    aws.sfn().send_task_success(
        taskToken=old["taskToken"], output=json.dumps({"decision": decision, "comment": comment, "by": by})
    )
    emit(review_id, "hitl.decided", {"decision": decision, "comment": comment, "by": by})
    return 200, {"reviewId": review_id, "decision": decision}


def ontology_components(event: dict[str, Any]) -> tuple[int, Any]:
    lang = (event.get("queryStringParameters") or {}).get("lang", i18n.DEFAULT_LANGUAGE)
    if not i18n.is_supported(lang):
        raise HttpError(400, f"lang must be one of {'|'.join(i18n.LANGUAGES)}")
    store = _latest_store()
    return 200, {"versionInfo": store.version_info, "lang": lang, "components": q.list_components(store, lang)}


def handler(event: dict[str, Any], _ctx: Any = None) -> dict[str, Any]:
    try:
        sub = _sub(event)
        claims = event["requestContext"]["authorizer"]["claims"]
        method, resource = event.get("httpMethod"), event.get("resource")
        rid = (event.get("pathParameters") or {}).get("id", "")
        if method == "POST" and resource == "/reviews":
            status, body = create_review(event, sub)
        elif method == "GET" and resource == "/reviews/{id}":
            status, body = get_review(rid, sub)
        elif method == "GET" and resource == "/reviews/{id}/events":
            status, body = get_events(event, rid, sub)
        elif method == "POST" and resource == "/reviews/{id}/decision":
            status, body = decide(event, rid, sub, claims)
        elif method == "GET" and resource == "/ontology/components":
            status, body = ontology_components(event)
        else:
            raise HttpError(404, "Not found")
        return _resp(event, status, body)
    except HttpError as e:
        return _resp(event, e.status, {"message": e.message})
    except Exception:
        log.exception("unhandled")
        return _resp(event, 500, {"message": "Internal error"})
