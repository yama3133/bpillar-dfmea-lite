from unittest.mock import MagicMock

from conftest import put_meta

from dfmea import aws, events

RID = "11111111-1111-4111-8111-111111111111"


def test_emit_persists_with_atomic_seq(aws_mock):
    put_meta(RID)
    e1 = events.emit(RID, "review.accepted", {"a": 1})
    e2 = events.emit(RID, "ontology.pinned", {"b": 2})
    assert (e1["seq"], e2["seq"]) == (1, 2)
    assert e1["v"] == 1 and e1["reviewId"] == RID and "ts" in e1
    assert [e["type"] for e in events.list_events(RID)] == ["review.accepted", "ontology.pinned"]
    assert [e["seq"] for e in events.list_events(RID, after=1)] == [2]


def test_fanout_only_owner_and_gone_cleanup(aws_mock, monkeypatch):
    put_meta(RID, sub="owner")
    for cid, sub in [("c-owner", "owner"), ("c-other", "intruder"), ("c-gone", "owner")]:
        aws.connections().put_item(Item={"connectionId": cid, "reviewId": RID, "userSub": sub})
    monkeypatch.setenv("WS_ENDPOINT", "https://example.execute-api.us-east-1.amazonaws.com/prod")

    class Gone(Exception):
        pass

    client = MagicMock()
    client.exceptions.GoneException = Gone
    sent = []

    def post(ConnectionId, Data):
        if ConnectionId == "c-gone":
            raise Gone()
        sent.append(ConnectionId)

    client.post_to_connection.side_effect = post
    monkeypatch.setattr(aws, "apigw_mgmt", lambda endpoint: client)
    events.emit(RID, "review.accepted", {})
    assert sent == ["c-owner"]
    assert "Item" not in aws.connections().get_item(Key={"connectionId": "c-gone"})
    assert "Item" in aws.connections().get_item(Key={"connectionId": "c-other"})


def test_unknown_type_rejected(aws_mock):
    put_meta(RID)
    import pytest

    with pytest.raises(ValueError):
        events.emit(RID, "bogus", {})
