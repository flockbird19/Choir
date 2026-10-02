"""
Local verification of Supabase access tokens (backend/src/backend/auth.py).

Every backend request is authorized by this check, so it must reject tokens that
are expired, signed by another key, meant for another audience or issuer, or
missing a user id — without calling the Auth server for valid modern tokens.
"""

import time
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from backend import auth

PROJECT_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


def _token(key=PROJECT_KEY, alg="ES256", **overrides):
    claims = {
        "sub": "user-1",
        "aud": "authenticated",
        "iss": auth._issuer(),
        "exp": int(time.time()) + 3600,
        "role": "authenticated",
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": "test-key"})


@pytest.fixture(autouse=True)
def project_signing_key():
    fake_client = SimpleNamespace(get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=PROJECT_KEY.public_key()))
    with patch.object(auth, "_jwks_client", return_value=fake_client):
        yield


def _rejected(token: str) -> bool:
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(token)
    return exc.value.status_code == 401


def test_valid_token_returns_user_id_without_calling_auth_server():
    with patch.object(auth, "get_db", side_effect=AssertionError("Auth server should not be called")):
        assert auth.verify_token(_token()) == "user-1"


def test_expired_token_rejected():
    assert _rejected(_token(exp=int(time.time()) - 60))


def test_token_signed_by_another_key_rejected():
    assert _rejected(_token(key=OTHER_KEY))


def test_wrong_audience_rejected():
    assert _rejected(_token(aud="anon"))


def test_wrong_issuer_rejected():
    assert _rejected(_token(iss="https://evil.example/auth/v1"))


def test_token_without_user_id_rejected():
    assert _rejected(_token(sub=None))


def test_garbage_token_rejected():
    assert _rejected("not-a-token")


def test_unsigned_token_rejected():
    assert _rejected(jwt.encode({"sub": "user-1", "aud": "authenticated", "iss": auth._issuer()}, None, algorithm="none"))


def test_agent_oauth_token_is_refused_but_the_same_person_s_session_passes():
    # Control: the person's own session token works.
    assert auth.verify_token(_token()) == "user-1"
    # The same token from Supabase's OAuth server (an agent) carries client_id: refused.
    assert _rejected(_token(client_id="f82bfb3a-6396-40cd-b99c-3eb1bef679fd"))


def test_legacy_agent_token_is_refused_before_asking_the_auth_server():
    legacy = jwt.encode({"sub": "user-9", "client_id": "c1"}, "shared-secret-at-least-32-bytes-long!!", algorithm="HS256")
    with patch.object(auth, "get_db", side_effect=AssertionError("Auth server should not be called")):
        assert _rejected(legacy)


def test_legacy_hs256_token_is_checked_by_auth_server():
    legacy = jwt.encode({"sub": "user-9", "aud": "authenticated"}, "shared-secret-at-least-32-bytes-long!!", algorithm="HS256")
    fake_db = SimpleNamespace(auth=SimpleNamespace(get_user=lambda _t: SimpleNamespace(user=SimpleNamespace(id="user-9"))))
    with patch.object(auth, "get_db", return_value=fake_db):
        assert auth.verify_token(legacy) == "user-9"


def test_legacy_token_rejected_by_auth_server_is_401():
    legacy = jwt.encode({"sub": "user-9"}, "shared-secret-at-least-32-bytes-long!!", algorithm="HS256")

    def reject(_token):
        raise RuntimeError("invalid JWT")

    fake_db = SimpleNamespace(auth=SimpleNamespace(get_user=reject))
    with patch.object(auth, "get_db", return_value=fake_db):
        assert _rejected(legacy)
