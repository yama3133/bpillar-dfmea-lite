"""Lazily created boto3 clients (lazy so tests can patch env / use moto)."""

from __future__ import annotations

import functools
import json
from decimal import Decimal
from typing import Any

import boto3

from . import config


@functools.cache
def ddb() -> Any:
    return boto3.resource("dynamodb", region_name=config.REGION)


@functools.cache
def s3() -> Any:
    return boto3.client("s3", region_name=config.REGION)


@functools.cache
def sfn() -> Any:
    return boto3.client("stepfunctions", region_name=config.REGION)


@functools.cache
def apigw_mgmt(endpoint: str) -> Any:
    return boto3.client("apigatewaymanagementapi", endpoint_url=endpoint, region_name=config.REGION)


_CACHED = (ddb, s3, sfn, apigw_mgmt)


def reset_clients() -> None:
    for f in _CACHED:
        f.cache_clear()


def reviews() -> Any:
    return ddb().Table(config.reviews_table())


def connections() -> Any:
    return ddb().Table(config.connections_table())


def to_ddb(obj: Any) -> Any:
    return json.loads(json.dumps(obj), parse_float=Decimal)


def from_ddb(obj: Any) -> Any:
    def conv(o: Any) -> Any:
        if isinstance(o, Decimal):
            return int(o) if o == o.to_integral_value() else float(o)
        raise TypeError
    return json.loads(json.dumps(obj, default=conv))
