"""
Unhandled errors must reach the browser as JSON with CORS headers, not as an
opaque "Failed to fetch" (see backend/src/backend/errors.py).
"""

import json
from unittest.mock import patch

import pytest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

import main
from backend.auth import get_current_user
from backend.errors import safe_sse_stream

ORIGIN = "http://localhost:3000"


@pytest.fixture(autouse=True)
def _default_cors_origins():
    """
    FU-5: CORSMiddleware is configured once, at import time, from the
    ALLOWED_ORIGINS env var — so these tests must not depend on whatever a
    developer's local backend/.env happens to set it to. Rebuild it here with
    the localhost default regardless.
    """
    middleware_before = list(main.app.user_middleware)
    stack_before = main.app.middleware_stack
    main.app.middleware_stack = None
    main.app.user_middleware = [m for m in middleware_before if m.cls is not CORSMiddleware]
    main.app.add_middleware(
        CORSMiddleware,
        allow_origins=main.parse_allowed_origins(None),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    yield
    main.app.user_middleware = middleware_before
    main.app.middleware_stack = stack_before


def _client() -> TestClient:
    main.app.dependency_overrides[get_current_user] = lambda: "user-1"
    return TestClient(main.app, raise_server_exceptions=False)


def teardown_function():
    main.app.dependency_overrides.clear()


def test_unhandled_error_returns_json_with_cors_headers():
    with patch.object(main, "list_saved_providers", side_effect=RuntimeError("relation ai_request_log does not exist")):
        response = _client().get("/api/keys", headers={"Origin": ORIGIN})

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == ORIGIN
    body = response.json()
    assert "relation ai_request_log does not exist" in body["detail"]
    assert body["request_id"] == response.headers["x-request-id"]


def test_production_hides_error_details(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with patch.object(main, "list_saved_providers", side_effect=RuntimeError("secret internals")):
        response = _client().get("/api/keys", headers={"Origin": ORIGIN})

    assert response.status_code == 500
    assert "secret internals" not in response.json()["detail"]
    assert response.json()["request_id"] in response.json()["detail"]


def test_http_errors_are_unchanged():
    response = _client().delete("/api/keys/not-a-provider", headers={"Origin": ORIGIN})

    assert response.status_code == 400
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.json() == {"detail": "Invalid provider 'not-a-provider'."}


def test_disallowed_origin_gets_no_cors_header():
    response = _client().get("/", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_stream_failure_becomes_sse_error_frame():
    def failing_stream():
        yield 'data: {"text": "Hel"}\n\n'
        raise RuntimeError("database went away")

    frames = list(safe_sse_stream(failing_stream()))

    assert frames[0] == 'data: {"text": "Hel"}\n\n'
    error = json.loads(frames[1].removeprefix("data: "))
    assert "database went away" in error["error"]


def test_closing_the_stream_still_runs_the_inner_cleanup():
    # llm.stream_ai_response saves partial replies in a `finally` when the client
    # disconnects; the wrapper must pass that close through.
    cleaned_up = []

    def stream():
        try:
            yield "data: {}\n\n"
            yield "data: {}\n\n"
        finally:
            cleaned_up.append(True)

    wrapped = safe_sse_stream(stream())
    next(wrapped)
    wrapped.close()

    assert cleaned_up == [True]
