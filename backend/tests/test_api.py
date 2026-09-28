import json

from botocore.stub import Stubber
from conftest import NS, api_event, put_meta

from dfmea import aws
from dfmea.handlers import api

RID = "33333333-3333-4333-8333-333333333333"


def call(ev):
    r = api.handler(ev)
    return r["statusCode"], json.loads(r["body"]), r["headers"]


def test_components(aws_mock):
    s, b, _ = call(api_event("GET", "/ontology/components"))
    assert s == 200 and b["versionInfo"] == "1.0.0" and len(b["components"]) == 7


def test_create_review_starts_execution(aws_mock, monkeypatch):
    started = {}

    class FakeSfn:
        def start_execution(self, **kw):
            started.update(kw)
            return {"executionArn": "arn:x"}

    monkeypatch.setattr(aws, "sfn", lambda: FakeSfn())
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://d.cloudfront.net,http://localhost:5173")
    body = {"reviewId": RID, "componentIri": NS + "SeatbeltAnchorMount", "scenario": "x"}
    s, b, h = call(api_event("POST", "/reviews", body=body, origin="http://localhost:5173"))
    assert s == 202 and started["name"] == RID and json.loads(started["input"]) == {"reviewId": RID}
    assert h["Access-Control-Allow-Origin"] == "http://localhost:5173"
    s, _, _ = call(api_event("POST", "/reviews", body=body))
    assert s == 409
    s, b, _ = call(api_event("GET", "/reviews/{id}/events", path_id=RID, qs={"after": "0"}))
    assert [e["type"] for e in b["events"]] == ["review.accepted"]


def test_create_review_validation(aws_mock):
    bad = [
        {"reviewId": "not-a-uuid", "componentIri": NS + "RoofRailJoint", "scenario": "x"},
        {"reviewId": "33333333-3333-1333-8333-333333333333", "componentIri": NS + "RoofRailJoint", "scenario": "x"},
        {"reviewId": RID, "componentIri": NS + "Nope", "scenario": "x"},
        {"reviewId": RID, "componentIri": NS + "RoofRailJoint", "scenario": ""},
    ]
    for body in bad:
        assert call(api_event("POST", "/reviews", body=body))[0] == 400


def test_other_user_gets_404(aws_mock):
    put_meta(RID, sub="owner")
    for ev in [api_event("GET", "/reviews/{id}", sub="intruder", path_id=RID),
               api_event("GET", "/reviews/{id}/events", sub="intruder", path_id=RID),
               api_event("POST", "/reviews/{id}/decision", sub="intruder", path_id=RID,
                         body={"decision": "approve"})]:
        assert call(ev)[0] == 404
    assert call(api_event("GET", "/reviews/{id}", sub="owner", path_id=RID))[0] == 200


def test_missing_claims_401(aws_mock):
    ev = api_event("GET", "/ontology/components")
    ev["requestContext"] = {}
    assert call(ev)[0] == 401


def test_decision_flow(aws_mock, monkeypatch):
    put_meta(RID, sub="owner", status="WAITING_HITL", taskToken="tok-1")
    client = aws.sfn()
    stub = Stubber(client)
    stub.add_response("send_task_success", {}, {
        "taskToken": "tok-1",
        "output": json.dumps({"decision": "approve", "comment": "ok", "by": "owner@example.com"}),
    })
    with stub:
        s, b, _ = call(api_event("POST", "/reviews/{id}/decision", sub="owner", path_id=RID,
                                 body={"decision": "approve", "comment": "ok"}))
    assert s == 200
    meta = aws.reviews().get_item(Key={"reviewId": RID, "sk": "META"})["Item"]
    assert "taskToken" not in meta and meta["status"] == "HITL_DECIDED"
    # second decision is rejected (no longer waiting)
    s, _, _ = call(api_event("POST", "/reviews/{id}/decision", sub="owner", path_id=RID, body={"decision": "reject"}))
    assert s == 409
    s, _, _ = call(api_event("POST", "/reviews/{id}/decision", sub="owner", path_id=RID, body={"decision": "maybe"}))
    assert s == 400


def test_get_review_hides_token_and_sorts(aws_mock):
    put_meta(RID, sub="owner", taskToken="secret")
    for fid, sev, st in [("F1", 2, "accepted"), ("F2", 9, "accepted"), ("F3", 9, "rejected")]:
        aws.reviews().put_item(Item=aws.to_ddb({
            "reviewId": RID, "sk": f"FINDING#{fid}", "finding_id": fid, "severity": sev, "occurrence": 2,
            "detection": 2, "confidence": 0.7, "validation": {"status": st, "code": "OK", "detail": ""}}))
    s, b, _ = call(api_event("GET", "/reviews/{id}", sub="owner", path_id=RID))
    assert "taskToken" not in b["review"]
    assert [f["finding_id"] for f in b["findings"]["accepted"]] == ["F2", "F1"]
    assert [f["finding_id"] for f in b["findings"]["rejected"]] == ["F3"]
