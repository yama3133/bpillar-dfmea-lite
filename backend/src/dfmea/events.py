"""Review event emission: persist EVT# item, then fan out to the owner's WebSocket connections."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from boto3.dynamodb.conditions import Key

from . import aws, config

log = logging.getLogger(__name__)

EVENT_TYPES = {
    "review.accepted", "ontology.pinned", "agent.started", "agent.finished", "agent.tool_call",
    "findings.proposed", "validation.result", "hitl.required", "hitl.decided", "review.completed", "review.failed",
}


def evt_sk(seq: int) -> str:
    return f"EVT#{seq:06d}"


def emit(review_id: str, type_: str, data: dict[str, Any]) -> dict[str, Any]:
    if type_ not in EVENT_TYPES:
        raise ValueError(f"unknown event type {type_}")
    table = aws.reviews()
    upd = table.update_item(
        Key={"reviewId": review_id, "sk": "META"},
        UpdateExpression="ADD seq :one",
        ConditionExpression="attribute_exists(reviewId)",
        ExpressionAttributeValues={":one": 1},
        ReturnValues="ALL_NEW",
    )
    meta = upd["Attributes"]
    seq = int(meta["seq"])
    event = {
        "v": 1,
        "reviewId": review_id,
        "seq": seq,
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "type": type_,
        "data": data,
    }
    body = json.dumps(event, ensure_ascii=False, default=str)
    table.put_item(
        Item={"reviewId": review_id, "sk": evt_sk(seq), "payload": body, "ttl": int(time.time()) + config.TTL_SECONDS}
    )
    _fan_out(review_id, str(meta.get("userSub", "")), body)
    return event


def _fan_out(review_id: str, owner_sub: str, body: str) -> None:
    endpoint = config.ws_endpoint()
    if not endpoint or not owner_sub:
        return
    conns = aws.connections().query(IndexName="byReview", KeyConditionExpression=Key("reviewId").eq(review_id))
    client = aws.apigw_mgmt(endpoint)
    for c in conns.get("Items", []):
        if c.get("userSub") != owner_sub:
            continue
        cid = c["connectionId"]
        try:
            client.post_to_connection(ConnectionId=cid, Data=body.encode("utf-8"))
        except client.exceptions.GoneException:
            aws.connections().delete_item(Key={"connectionId": cid})
        except Exception:  # a broken socket must not fail the workflow; clients backfill via GET events
            log.exception("post_to_connection failed for %s", cid)


def list_events(review_id: str, after: int = 0) -> list[dict[str, Any]]:
    table = aws.reviews()
    items: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("reviewId").eq(review_id) & Key("sk").between(evt_sk(after + 1), evt_sk(999999))
    }
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return [json.loads(i["payload"]) for i in items]
