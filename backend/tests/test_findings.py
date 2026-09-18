"""
K2 "Publish findings": POST /api/findings/{thread_id} drafts a Team Space post from a
private thread. No real model or database is used.
"""

import sys
import types
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import main
from backend import findings, llm
from backend.auth import get_current_user
from tests.fakes import FakeClient

DB = FakeClient(
    threads=[
        {"id": "private", "project_id": "p1", "type": "private", "owner_id": "u-me"},
        {"id": "empty", "project_id": "p1", "type": "private", "owner_id": "u-me"},
        {"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None},
    ],
    messages=[
        {"thread_id": "private", "sender_type": "user", "sender_id": "u-me", "content": "Should we use Postgres?", "created_at": "1"},
        {"thread_id": "private", "sender_type": "assistant", "sender_id": None, "content": "Yes, for RLS.", "created_at": "2"},
    ],
)


@pytest.fixture
def client():
    main.app.dependency_overrides[get_current_user] = lambda: "u-me"
    with patch.object(main, "_check_and_record_rate_limit"):
        yield TestClient(main.app, raise_server_exceptions=False)
    main.app.dependency_overrides.clear()


def _fake_anthropic(captured: dict, text: str = "## Summary\nPostgres it is."):
    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return types.SimpleNamespace(content=[types.SimpleNamespace(text=text)])

    return types.SimpleNamespace(Anthropic=lambda **kw: captured.update(api_key=kw["api_key"]) or types.SimpleNamespace(messages=FakeMessages()))


@contextmanager
def _backend(keys: dict[str, str], captured: dict, has_access: bool = True):
    lookup = lambda uid, provider: keys.get(provider) if uid == "u-me" else None  # noqa: E731
    with (
        patch.object(main, "verify_thread_access", return_value=has_access),
        patch.object(llm, "get_db", return_value=DB),
        patch.object(llm, "get_api_key", side_effect=lookup),
        patch.object(findings, "get_api_key", side_effect=lookup),
        patch.dict(sys.modules, {"anthropic": _fake_anthropic(captured)}),
    ):
        yield


def test_access_denied_without_calling_the_model(client):
    captured: dict = {}
    with _backend({"anthropic": "sk-test"}, captured, has_access=False):
        response = client.post("/api/findings/private")
    assert response.status_code == 403
    assert captured == {}


def test_no_key_gives_friendly_error(client):
    captured: dict = {}
    with _backend({}, captured):
        response = client.post("/api/findings/private")
    assert response.status_code == 400
    assert "No API key found" in response.json()["detail"]
    assert captured == {}


def test_happy_path_drafts_three_sections_from_the_private_thread(client):
    captured: dict = {}
    with _backend({"anthropic": "sk-test"}, captured):
        response = client.post("/api/findings/private")
    assert response.status_code == 200
    assert response.json() == {"draft": "## Summary\nPostgres it is."}
    assert captured["api_key"] == "sk-test"
    for heading in ("## Summary", "## Recommendation", "## Open questions"):
        assert heading in captured["system"]
    prompt = captured["messages"][0]["content"]
    assert "Me: Should we use Postgres?" in prompt
    assert "Choir AI: Yes, for RLS." in prompt


def test_shared_thread_and_empty_thread_are_rejected(client):
    captured: dict = {}
    with _backend({"anthropic": "sk-test"}, captured):
        shared = client.post("/api/findings/shared")
        empty = client.post("/api/findings/empty")
    assert shared.status_code == 400
    assert "private thread" in shared.json()["detail"]
    assert empty.status_code == 400
    assert captured == {}


def test_rate_limit_from_provider_is_friendly():
    with pytest.raises(RuntimeError, match="Rate limit reached"):
        with patch.dict(sys.modules, {"anthropic": types.SimpleNamespace(Anthropic=lambda **_: (_ for _ in ()).throw(Exception("Error code: 429")))}):
            llm.complete_once("anthropic", "m", "k", "sys", "hi", max_tokens=100)


def test_export_names_only_the_owner_of_a_published_post():
    names = {"u-me": "Meera"}
    published = {"sender_type": "user", "sender_id": "u-me", "source_thread_id": "private"}
    assert main._published_from(published, names) == "Meera's private thread"
    assert main._published_from({"sender_type": "user", "sender_id": "u-me"}, names) is None
