"""Analyze task: run the agents against the pinned ontology and store proposed findings."""

from __future__ import annotations

import time
from typing import Any

from strands.types.exceptions import ModelThrottledException

from .. import aws, config
from ..agents.orchestrator import run_analysis
from ..events import emit
from .workflow import _update_meta, get_meta, load_pinned_store, rpn


class Throttling(Exception):
    """Surfaced as errorType 'Throttling' so the state machine Retry can match it."""


def handler(event: dict[str, Any], _ctx: Any = None) -> dict[str, Any]:
    rid = event["reviewId"]
    meta = get_meta(rid)
    store = load_pinned_store(meta)
    try:
        res = run_analysis(store, meta["componentIri"], meta["scenario"], lambda t, d: emit(rid, t, d))
    except ModelThrottledException as e:
        raise Throttling(str(e)) from e
    table = aws.reviews()
    ttl = int(time.time()) + config.TTL_SECONDS
    summary = []
    with table.batch_writer() as bw:
        for f in res.findings.findings:
            d = f.model_dump()
            bw.put_item(Item=aws.to_ddb({"reviewId": rid, "sk": f"FINDING#{f.finding_id}", **d, "rpn": rpn(d), "ttl": ttl}))
            summary.append({"findingId": f.finding_id, "failureModeIri": f.failure_mode_iri,
                            "confidence": f.confidence, "rpn": rpn(d)})
    _update_meta(rid, usage=res.usage, analysisSec=res.elapsed_sec, updatedAt=int(time.time()))
    emit(rid, "findings.proposed", {"count": len(summary), "findings": summary, "usage": res.usage,
                                    "elapsedSec": res.elapsed_sec})
    return {"reviewId": rid, "findingCount": len(summary)}
