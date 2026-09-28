"""Runtime configuration read from environment variables."""

from __future__ import annotations

import os

from botocore.config import Config

REGION = os.environ.get("AWS_REGION", "us-east-1")
ANALYST_MODEL_ID = os.environ.get("ANALYST_MODEL_ID", "us.anthropic.claude-sonnet-4-6")
SPECIALIST_MODEL_ID = os.environ.get("SPECIALIST_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")

BEDROCK_CONFIG = Config(read_timeout=300, connect_timeout=10, retries={"max_attempts": 4, "mode": "adaptive"})


def reviews_table() -> str:
    return os.environ["REVIEWS_TABLE"]


def connections_table() -> str:
    return os.environ["CONNECTIONS_TABLE"]


def ontology_bucket() -> str:
    return os.environ["ONTOLOGY_BUCKET"]


def ontology_key() -> str:
    return os.environ.get("ONTOLOGY_KEY", "bpillar.ttl")


def hitl_threshold() -> float:
    return float(os.environ.get("HITL_CONFIDENCE_THRESHOLD", "0.6"))


def ws_endpoint() -> str | None:
    """https://{apiId}.execute-api.{region}.amazonaws.com/{stage} for the management API."""
    return os.environ.get("WS_ENDPOINT")


TTL_SECONDS = 7 * 24 * 3600
