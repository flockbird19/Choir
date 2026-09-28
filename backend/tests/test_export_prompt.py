"""
"Export as prompt": POST /api/export-prompt/{thread_id} has the AI rewrite a thread
into a paste-ready prompt. No real model or database is used.
"""

import sys
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import main
from backend import llm
from backend.auth import get_current_user
from tests.fakes import FakeClient
from tests.test_findings import _fake_anthropic

DB = FakeClient(
    projects=[{"id": "p1", "team_id": "t1"}],
    team_members=[
        {"team_id": "t1", "user_id": "u-me", "role": "owner", "joined_at": "1"},
        {"team_id": "t1", "user_id": "u-arjun", "role": "member", "joined_at": "2"},
    ],
    profiles=[{"id": "u-me", "display_name": "Priya"}, {"id": "u-arjun", "display_name": "Arjun"}],
    threads=[
        {"id": "private", "project_id": "p1", "type": "private", "owner_id": "u-me", "name": "Wiring plan"},
        {"id": "empty", "project_id": "p1", "type": "private", "owner_id": "u-me"},
        {"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None},
    ],
    messages=[
        {"thread_id": "private", "sender_type": "user", "sender_id": "u-me", "content": "How do I wire it to I2C?", "created_at": "1"},
        {"thread_id": "private", "sender_type": "assistant", "sender_id": None, "content": "SDA to GPIO21.", "created_at": "2"},
        {"thread_id": "shared", "sender_type": "user", "sender_id": "u-arjun", "content": "Use the VL53L0X.", "created_at": "3", "is_decision": True, "pinned_at": "4"},
        {"thread_id": "shared", "sender_type": "user", "sender_id": "u-arjun", "content": "Lunch at 1?", "created_at": "5"},
    ],
)


@pytest.fixture
def client():
    main.app.dependency_overrides[get_current_user] = lambda: "u-me"
    with patch.object(main, "_check_and_record_rate_limit"):
        yield TestClient(main.app, raise_server_exceptions=False)
    main.app.dependency_overrides.clear()


@contextmanager
def _backend(keys: dict[str, str], captured: dict, has_access: bool = True):
    lookup = lambda uid, provider: keys.get(provider) if uid == "u-me" else None  # noqa: E731
    with (
        patch.object(main, "verify_thread_access", return_value=has_access),
        patch.object(llm, "get_db", return_value=DB),
        patch.object(llm, "get_api_key", side_effect=lookup),
        patch.dict(sys.modules, {"anthropic": _fake_anthropic(captured, "**Goal:** wire the sensor.")}),
    ):
        yield


def test_access_denied_without_calling_the_model(client):
    captured: dict = {}
    with _backend({"anthropic": "sk-test"}, captured, has_access=False):
        response = client.post("/api/export-prompt/private")
    assert response.status_code == 403
    assert captured == {}


def test_no_key_and_empty_thread_give_friendly_errors(client):
    captured: dict = {}
    with _backend({}, captured):
        no_key = client.post("/api/export-prompt/private")
    with _backend({"anthropic": "sk-test"}, captured):
        empty = client.post("/api/export-prompt/empty")
    assert no_key.status_code == 400 and "No API key found" in no_key.json()["detail"]
    assert empty.status_code == 400 and "no messages" in empty.json()["detail"]
    assert captured == {}


def test_ai_gets_the_thread_with_names_and_only_pinned_decisions(client):
    captured: dict = {}
    with _backend({"anthropic": "sk-test"}, captured):
        response = client.post("/api/export-prompt/private")
    assert response.status_code == 200
    assert response.json() == {"prompt": "**Goal:** wire the sensor."}
    assert "Do not treat an AI recommendation, tentative private conclusion" in captured["system"]
    sent = captured["messages"][0]["content"]
    assert "Priya (me): How do I wire it to I2C?" in sent
    assert "Choir AI: SDA to GPIO21." in sent
    assert "] Use the VL53L0X." in sent
    assert "Lunch at 1?" not in sent
