"""Cognito ID token verification for the WebSocket $connect route."""

from __future__ import annotations

import functools
import os
from typing import Any

import jwt
from jwt import PyJWKClient

from . import config


class AuthError(Exception):
    pass


def issuer() -> str:
    return f"https://cognito-idp.{config.REGION}.amazonaws.com/{os.environ['USER_POOL_ID']}"


@functools.cache
def _jwks(iss: str) -> PyJWKClient:
    return PyJWKClient(f"{iss}/.well-known/jwks.json", cache_keys=True)


def verify_id_token(token: str) -> dict[str, Any]:
    if not token:
        raise AuthError("missing token")
    iss = issuer()
    try:
        key = _jwks(iss).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=os.environ["USER_POOL_CLIENT_ID"],
            issuer=iss,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.PyJWTError as e:
        raise AuthError(str(e)) from e
    if claims.get("token_use") != "id":
        raise AuthError("token_use must be id")
    return claims
