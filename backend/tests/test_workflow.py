from conftest import NS, TTL_V2, good_finding, put_meta

from dfmea import aws, events
from dfmea.handlers import workflow

RID = "22222222-2222-4222-8222-222222222222"


def put_finding(f):
    aws.reviews().put_item(Item=aws.to_ddb({"reviewId": RID, "sk": f"FINDING#{f['finding_id']}", **f}))


def types():
    return [e["type"] for e in events.list_events(RID)]


def test_pin_records_version_and_survives_overwrite(aws_mock):
    put_meta(RID)
    workflow.handler({"step": "pin", "reviewId": RID})
    meta = workflow.get_meta(RID)
    assert meta["ontology"]["versionInfo"] == "1.0.0"
    # overwrite the key with v2; the pinned store must still be v1
    aws_mock["s3"].put_object(Bucket="onto-bucket", Key="bpillar.ttl", Body=TTL_V2.read_bytes())
    assert workflow.load_pinned_store(meta).version_info == "1.0.0"
    assert types() == ["ontology.pinned"]


def test_validate_and_hitl_threshold(aws_mock, monkeypatch):
    put_meta(RID)
    workflow.pin(RID)
    put_finding(good_finding(finding_id="F1", confidence=0.9))
    put_finding(good_finding(finding_id="F2", confidence=0.5, cause_path=[NS + "SpotWeldResidualStress"]))
    put_finding(good_finding(finding_id="F3", confidence=0.1, component_iri=NS + "RoofRailJoint"))
    out = workflow.handler({"step": "validate", "reviewId": RID})
    # F3 is rejected so its low confidence does not count; F2 is accepted and below 0.6
    assert out == {"reviewId": RID, "needsHitl": True, "acceptedCount": 2, "rejectedCount": 1}
    monkeypatch.setenv("HITL_CONFIDENCE_THRESHOLD", "0.4")
    assert workflow.validate(RID)["needsHitl"] is False
    f3 = [f for f in workflow.get_findings(RID) if f["finding_id"] == "F3"][0]
    assert f3["validation"]["code"] == "COMPONENT_MISMATCH"


def test_hitl_request_and_finalize_sorted(aws_mock):
    put_meta(RID)
    workflow.pin(RID)
    put_finding(good_finding(finding_id="F1", severity=5, occurrence=2, detection=2))
    put_finding(good_finding(finding_id="F2", severity=10, occurrence=5, detection=5))
    put_finding(good_finding(finding_id="F3", effect_iri=NS + "RoofCrushResistanceLoss"))
    workflow.validate(RID)
    workflow.handler({"step": "hitl_request", "reviewId": RID, "taskToken": "tok"})
    meta = workflow.get_meta(RID)
    assert meta["status"] == "WAITING_HITL" and meta["taskToken"] == "tok"
    out = workflow.handler({"step": "finalize", "reviewId": RID, "outcome": "completed"})
    assert out["status"] == "completed"
    report = workflow.get_meta(RID)["report"]
    assert [a["findingId"] for a in report["accepted"]] == ["F2", "F1"]
    assert report["rejected"][0]["code"] == "BROKEN_CAUSAL_PATH"
    assert report["ontology"]["versionInfo"] == "1.0.0"
    assert types()[-2:] == ["hitl.required", "review.completed"]


def test_fail(aws_mock):
    put_meta(RID)
    workflow.handler({"step": "fail", "reviewId": RID, "error": {"Error": "X", "Cause": "boom"}})
    assert workflow.get_meta(RID)["status"] == "failed"
    assert types() == ["review.failed"]
