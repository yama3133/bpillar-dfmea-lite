import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from dfmea import auth, aws
from dfmea.handlers import ws

POOL, CLIENT = "us-east-1_TEST", "client123"
ISS = f"https://cognito-idp.us-east-1.amazonaws.com/{POOL}"
RID = "44444444-4444-4444-8444-444444444444"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeJwks:
    def get_signing_key_from_jwt(self, token):
        class K:
            key = KEY.public_key()
        return K()


@pytest.fixture(autouse=True)
def cognito_env(monkeypatch):
    monkeypatch.setenv("USER_POOL_ID", POOL)
    monkeypatch.setenv("USER_POOL_CLIENT_ID", CLIENT)
    monkeypatch.setattr(auth, "_jwks", lambda iss: FakeJwks())


def token(key=KEY, **over):
    now = int(time.time())
    claims = {"sub": "user-a", "aud": CLIENT, "iss": ISS, "token_use": "id", "iat": now, "exp": now + 600}
    claims.update(over)
    return jwt.encode(claims, key, algorithm="RS256")


def connect(tok, rid=RID):
    return ws.handler({"requestContext": {"routeKey": "$connect", "connectionId": "cid-1"},
                       "queryStringParameters": {"token": tok, "reviewId": rid} if tok is not None else None})


def test_valid_token(aws_mock):
    assert auth.verify_id_token(token())["sub"] == "user-a"
    assert connect(token())["statusCode"] == 200
    item = aws.connections().get_item(Key={"connectionId": "cid-1"})["Item"]
    assert item["userSub"] == "user-a" and item["reviewId"] == RID
    assert ws.handler({"requestContext": {"routeKey": "$disconnect", "connectionId": "cid-1"}})["statusCode"] == 200
    assert "Item" not in aws.connections().get_item(Key={"connectionId": "cid-1"})


@pytest.mark.parametrize("bad", [
    {"token_use": "access"}, {"aud": "other"}, {"iss": "https://evil"}, {"exp": int(time.time()) - 10},
])
def test_rejects_bad_claims(aws_mock, bad):
    assert connect(token(**bad))["statusCode"] == 401


def test_rejects_wrong_signature_missing_token_bad_review(aws_mock):
    assert connect(token(key=OTHER))["statusCode"] == 401
    assert connect(None)["statusCode"] == 401
    assert connect(token(), rid="nope")["statusCode"] == 401
