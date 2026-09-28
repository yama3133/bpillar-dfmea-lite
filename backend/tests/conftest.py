from __future__ import annotations

import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
TTL_V1 = ROOT / "ontology" / "bpillar.ttl"
TTL_V2 = ROOT / "ontology" / "bpillar-v2.ttl"
PRESETS = ROOT / "presets"

NS = "https://example.org/bpillar-dfmea/id/"


@pytest.fixture
def store():
    from dfmea.ontology.store import OntologyStore

    return OntologyStore.from_file(TTL_V1)


@pytest.fixture
def aws_env(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.setenv("REVIEWS_TABLE", "Reviews")
    monkeypatch.setenv("CONNECTIONS_TABLE", "Connections")
    monkeypatch.setenv("ONTOLOGY_BUCKET", "onto-bucket")
    monkeypatch.setenv("ONTOLOGY_KEY", "bpillar.ttl")
    monkeypatch.setenv("STATE_MACHINE_ARN", "arn:aws:states:us-east-1:123456789012:stateMachine:Dfmea")
    monkeypatch.delenv("WS_ENDPOINT", raising=False)
    yield os.environ


def good_finding(**over):
    f = {
        "finding_id": "F1",
        "component_iri": NS + "SeatbeltAnchorMount",
        "failure_mode_iri": NS + "HAZDelayedFracture",
        "cause_path": [NS + "Austenitization", NS + "HydrogenAbsorption", NS + "HydrogenEmbrittlement"],
        "effect_iri": NS + "AnchorPulloutUnderLoad",
        "severity": 10,
        "occurrence": 3,
        "detection": 6,
        "confidence": 0.8,
        "rationale": "test",
        "recommended_actions": ["a"],
    }
    f.update(over)
    return f


@pytest.fixture
def aws_mock(aws_env):
    import boto3
    from moto import mock_aws

    from dfmea import aws

    aws.reset_clients()
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name="us-east-1")
        ddb.create_table(
            TableName="Reviews",
            KeySchema=[{"AttributeName": "reviewId", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "reviewId", "AttributeType": "S"},
                                  {"AttributeName": "sk", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        ddb.create_table(
            TableName="Connections",
            KeySchema=[{"AttributeName": "connectionId", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "connectionId", "AttributeType": "S"},
                                  {"AttributeName": "reviewId", "AttributeType": "S"}],
            GlobalSecondaryIndexes=[{"IndexName": "byReview",
                                     "KeySchema": [{"AttributeName": "reviewId", "KeyType": "HASH"}],
                                     "Projection": {"ProjectionType": "ALL"}}],
            BillingMode="PAY_PER_REQUEST",
        )
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="onto-bucket")
        s3.put_bucket_versioning(Bucket="onto-bucket", VersioningConfiguration={"Status": "Enabled"})
        s3.put_object(Bucket="onto-bucket", Key="bpillar.ttl", Body=TTL_V1.read_bytes())
        yield {"ddb": ddb, "s3": s3}
    aws.reset_clients()


def put_meta(review_id, sub="user-a", **extra):
    from dfmea import aws

    item = {"reviewId": review_id, "sk": "META", "userSub": sub, "componentIri": NS + "SeatbeltAnchorMount",
            "scenario": "s", "status": "ACCEPTED", "seq": 0}
    item.update(extra)
    aws.reviews().put_item(Item=aws.to_ddb(item))


def api_event(method, resource, sub="user-a", body=None, path_id=None, qs=None, origin=None):
    import json as _json

    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": {"id": path_id} if path_id else None,
        "queryStringParameters": qs,
        "headers": {"origin": origin} if origin else {},
        "body": _json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"claims": {"sub": sub, "email": f"{sub}@example.com"}}},
    }
