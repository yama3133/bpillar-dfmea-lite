"""WebSocket $connect / $disconnect."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from .. import aws
from ..auth import AuthError, verify_id_token

log = logging.getLogger(__name__)
CONNECTION_TTL = 2 * 3600


def handler(event: dict[str, Any], _ctx: Any = None) -> dict[str, Any]:
    rc = event["requestContext"]
    route, cid = rc["routeKey"], rc["connectionId"]
    if route == "$connect":
        qs = event.get("queryStringParameters") or {}
        try:
            claims = verify_id_token(qs.get("token", ""))
            review_id = str(uuid.UUID(qs.get("reviewId", "")))
        except (AuthError, ValueError) as e:
            log.info("connect rejected: %s", type(e).__name__)
            return {"statusCode": 401, "body": "Unauthorized"}
        aws.connections().put_item(Item={
            "connectionId": cid, "reviewId": review_id, "userSub": claims["sub"],
            "ttl": int(time.time()) + CONNECTION_TTL,
        })
        return {"statusCode": 200}
    if route == "$disconnect":
        aws.connections().delete_item(Key={"connectionId": cid})
        return {"statusCode": 200}
    return {"statusCode": 400}
