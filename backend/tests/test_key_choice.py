"""
Whose API key powers a reply (L1).

The shared thread runs on the project owner's key, so an invited teammate with no
keys of their own can still use @AI there. Private threads always use the caller's
own keys.
"""

import sys
import types
from contextlib import contextmanager
from unittest.mock import patch

from backend import llm
from tests.fakes import FakeClient

DB = FakeClient(
    teams=[{"id": "team-1", "name": "hackathon"}],
    projects=[
        {
            "id": "p1",
            "team_id": "team-1",
            "name": "General",
            "created_by": "u-owner",
            "shared_model_provider": "anthropic",
            "shared_model_name": "claude-haiku-4-5",
        }
    ],
    team_members=[
        {"team_id": "team-1", "user_id": "u-owner", "role": "owner", "joined_at": "1"},
        {"team_id": "team-1", "user_id": "u-member", "role": "member", "joined_at": "2"},
    ],
    threads=[
        {"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None},
        {"id": "member-private", "project_id": "p1", "type": "private", "owner_id": "u-member"},
    ],
    messages=[{"thread_id": "shared", "sender_type": "user", "sender_id": "u-member", "content": "@ai hi", "created_at": "1"}],
)


def _run(thread_id: str, user_id: str, keys: dict[tuple[str, str], str]):
    used: dict = {}

    class FakeMessages:
        @contextmanager
        def stream(self, **kwargs):
            used["model"] = kwargs["model"]
            yield types.SimpleNamespace(text_stream=iter(()))

    def fake_client(**kwargs):
        used["api_key"] = kwargs["api_key"]
        return types.SimpleNamespace(messages=FakeMessages())

    with (
        patch.object(llm, "get_db", return_value=DB),
        patch.object(llm, "get_api_key", side_effect=lambda uid, provider: keys.get((uid, provider))),
        patch.object(llm, "_fetch_user_name", return_value="Someone"),
        patch.dict(sys.modules, {"anthropic": types.SimpleNamespace(Anthropic=fake_client)}),
    ):
        frames = list(llm.stream_ai_response(thread_id, user_id, "anthropic", "claude-opus-5", None))
    return used, frames


def test_member_without_keys_uses_owner_key_in_shared_thread():
    used, frames = _run("shared", "u-member", {("u-owner", "anthropic"): "sk-owner"})
    assert used == {"api_key": "sk-owner", "model": "claude-haiku-4-5"}
    assert not any("error" in frame for frame in frames)


def test_shared_thread_falls_back_to_callers_key_when_owner_has_none():
    used, _ = _run("shared", "u-member", {("u-member", "anthropic"): "sk-member"})
    assert used["api_key"] == "sk-member"


def test_private_thread_never_uses_owner_key():
    used, frames = _run("member-private", "u-member", {("u-owner", "anthropic"): "sk-owner"})
    assert used == {}
    assert "No API key found" in frames[0]


def test_nobody_has_a_key_gives_friendly_error():
    used, frames = _run("shared", "u-member", {})
    assert used == {}
    assert "No API key found" in frames[0]
