"""Step Functions task handler; `step` selects the operation. State only carries IDs."""

from __future__ import annotations

import time
from typing import Any

from boto3.dynamodb.conditions import Key

from .. import aws, config
from ..events import emit
from ..ontology.store import OntologyStore
from ..ontology.validate import validate_finding


def get_meta(review_id: str) -> dict[str, Any]:
    item = aws.reviews().get_item(Key={"reviewId": review_id, "sk": "META"}).get("Item")
    if not item:
        raise KeyError(f"review {review_id} not found")
    return item


def load_pinned_store(meta: dict[str, Any]) -> OntologyStore:
    onto = meta["ontology"]
    return OntologyStore.from_s3(aws.s3(), onto["bucket"], onto["key"], onto["versionId"])


def get_findings(review_id: str) -> list[dict[str, Any]]:
    resp = aws.reviews().query(
        KeyConditionExpression=Key("reviewId").eq(review_id) & Key("sk").begins_with("FINDING#")
    )
    return [aws.from_ddb(i) for i in resp.get("Items", [])]


def _update_meta(review_id: str, **attrs: Any) -> None:
    names = {f"#{k}": k for k in attrs}
    values = {f":{k}": aws.to_ddb(v) for k, v in attrs.items()}
    aws.reviews().update_item(
        Key={"reviewId": review_id, "sk": "META"},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in attrs),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def pin(review_id: str) -> dict[str, Any]:
    bucket, key = config.ontology_bucket(), config.ontology_key()
    head = aws.s3().head_object(Bucket=bucket, Key=key)
    version_id = head["VersionId"]
    store = OntologyStore.from_s3(aws.s3(), bucket, key, version_id)
    onto = {
        "bucket": bucket, "key": key, "versionId": version_id,
        "sha256": store.sha256, "versionInfo": store.version_info,
    }
    _update_meta(review_id, ontology=onto, status="ANALYZING", updatedAt=int(time.time()))
    emit(review_id, "ontology.pinned", {k: onto[k] for k in ("versionId", "sha256", "versionInfo", "key")})
    return {"reviewId": review_id}


def validate(review_id: str) -> dict[str, Any]:
    meta = get_meta(review_id)
    store = load_pinned_store(meta)
    threshold = config.hitl_threshold()
    items, accepted, rejected, low = [], 0, 0, []
    for f in get_findings(review_id):
        v = validate_finding(store, f)
        aws.reviews().update_item(
            Key={"reviewId": review_id, "sk": f"FINDING#{f['finding_id']}"},
            UpdateExpression="SET validation = :v",
            ExpressionAttributeValues={":v": v},
        )
        items.append({"findingId": f["finding_id"], **v})
        if v["status"] == "accepted":
            accepted += 1
            if float(f["confidence"]) < threshold:
                low.append({"findingId": f["finding_id"], "confidence": f["confidence"]})
        else:
            rejected += 1
    needs_hitl = bool(low)
    _update_meta(review_id, status="VALIDATED", lowConfidence=low, updatedAt=int(time.time()))
    emit(review_id, "validation.result", {
        "acceptedCount": accepted, "rejectedCount": rejected, "needsHitl": needs_hitl,
        "threshold": threshold, "items": items,
    })
    return {"reviewId": review_id, "needsHitl": needs_hitl, "acceptedCount": accepted, "rejectedCount": rejected}


def hitl_request(review_id: str, task_token: str) -> dict[str, Any]:
    meta = get_meta(review_id)
    _update_meta(review_id, taskToken=task_token, status="WAITING_HITL", updatedAt=int(time.time()))
    emit(review_id, "hitl.required", {
        "threshold": config.hitl_threshold(), "lowConfidence": aws.from_ddb(meta.get("lowConfidence", [])),
    })
    return {"reviewId": review_id}


def rpn(f: dict[str, Any]) -> int:
    return int(f["severity"]) * int(f["occurrence"]) * int(f["detection"])


def build_report(meta: dict[str, Any], findings: list[dict[str, Any]], outcome: str) -> dict[str, Any]:
    accepted = [f for f in findings if f.get("validation", {}).get("status") == "accepted"]
    rejected = [f for f in findings if f.get("validation", {}).get("status") != "accepted"]
    accepted.sort(key=lambda f: (-rpn(f), f["finding_id"]))
    onto = aws.from_ddb(meta.get("ontology", {}))
    return {
        "outcome": outcome,
        "ontology": {k: onto.get(k) for k in ("versionInfo", "versionId", "sha256")},
        "accepted": [{"findingId": f["finding_id"], "rpn": rpn(f)} for f in accepted],
        "rejected": [{"findingId": f["finding_id"], "code": f.get("validation", {}).get("code")} for f in rejected],
        "decision": aws.from_ddb(meta.get("decision")) if meta.get("decision") else None,
    }


def finalize(review_id: str, outcome: str) -> dict[str, Any]:
    meta = get_meta(review_id)
    report = build_report(meta, get_findings(review_id), outcome)
    _update_meta(review_id, status=outcome, report=report, updatedAt=int(time.time()))
    emit(review_id, "review.completed", {"status": outcome, "report": report})
    return {"reviewId": review_id, "status": outcome}


def fail(review_id: str, error: dict[str, Any] | None) -> dict[str, Any]:
    err = {"error": str((error or {}).get("Error", "Unknown")), "cause": str((error or {}).get("Cause", ""))[:1000]}
    _update_meta(review_id, status="failed", failure=err, updatedAt=int(time.time()))
    emit(review_id, "review.failed", err)
    return {"reviewId": review_id, "status": "failed"}


def handler(event: dict[str, Any], _ctx: Any = None) -> dict[str, Any]:
    step, rid = event["step"], event["reviewId"]
    if step == "pin":
        return pin(rid)
    if step == "validate":
        return validate(rid)
    if step == "hitl_request":
        return hitl_request(rid, event["taskToken"])
    if step == "finalize":
        return finalize(rid, event["outcome"])
    if step == "fail":
        return fail(rid, event.get("error"))
    raise ValueError(f"unknown step {step}")
