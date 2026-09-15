import logging
from functools import lru_cache

import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.db import SUPABASE_URL, get_db

logger = logging.getLogger("choir")

security = HTTPBearer()

# Supabase access tokens are signed with the project's asymmetric JWT signing key.
ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
AUDIENCE = "authenticated"


def _issuer() -> str:
    return f"{SUPABASE_URL.rstrip('/')}/auth/v1"


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    # Public signing keys, fetched once and cached for 10 minutes.
    return jwt.PyJWKClient(f"{_issuer()}/.well-known/jwks.json", cache_keys=True, lifespan=600, timeout=10)


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Invalid or expired authentication token.")


def _verify_with_auth_server(token: str) -> str:
    """Fallback for legacy shared-secret (HS256) tokens: ask the Supabase Auth server."""
    try:
        user_response = get_db().auth.get_user(token)
    except Exception:
        logger.info("Auth server rejected a token", exc_info=True)
        raise _unauthorized()
    if not user_response or not user_response.user:
        raise _unauthorized()
    return user_response.user.id


def verify_token(token: str) -> str:
    """
    Verify a Supabase access token and return the user id.

    Checks the signature against the project's public signing keys locally, so a
    request doesn't wait on a round trip to the Auth server.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _unauthorized()

    if str(header.get("alg", "")).upper().startswith("HS"):
        return _verify_with_auth_server(token)

    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=ASYMMETRIC_ALGORITHMS,
            audience=AUDIENCE,
            issuer=_issuer(),
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWKClientConnectionError:
        logger.exception("Could not fetch Supabase signing keys")
        raise HTTPException(status_code=503, detail="Could not verify your login right now. Please try again.")
    except jwt.PyJWTError:
        raise _unauthorized()

    return claims["sub"]


def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    """FastAPI dependency: the authenticated user's id, or a 401."""
    return verify_token(credentials.credentials)
