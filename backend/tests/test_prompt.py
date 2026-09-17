"""
What the AI is told about the team (backend/src/backend/llm.py).

The AI must know everyone on the team — including people who haven't posted —
and who wrote each message, in shared threads, in the shared-thread context of
private threads, and in the Catch Me Up digest.
"""

import sys
import types
from contextlib import contextmanager
from unittest.mock import patch

import pytest

from backend import llm
from tests.fakes import FakeClient

NAMES = {"u-owner": "Venu", "u-bob": "Bob", "u-quiet": "Quiet Priya"}

DB = FakeClient(
    teams=[{"id": "team-1", "name": "hackathon"}],
    projects=[{"id": "p1", "team_id": "team-1", "name": "General", "created_by": "u-owner"}],
    team_members=[
        {"team_id": "team-1", "user_id": "u-owner", "role": "owner", "joined_at": "2026-08-01"},
        {"team_id": "team-1", "user_id": "u-bob", "role": "member", "joined_at": "2026-08-02"},
        {"team_id": "team-1", "user_id": "u-quiet", "role": "member", "joined_at": "2026-08-03"},
    ],
    threads=[
        {"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None},
        {"id": "private", "project_id": "p1", "type": "private", "owner_id": "u-bob"},
    ],
    messages=[
        {"thread_id": "shared", "sender_type": "user", "sender_id": "u-owner", "content": "lets do frontend", "created_at": "1"},
        {"thread_id": "shared", "sender_type": "user", "sender_id": "u-bob", "content": "yo gang", "created_at": "2"},
        {"thread_id": "shared", "sender_type": "assistant", "sender_id": None, "content": "Hi team", "created_at": "3"},
        {"thread_id": "shared", "sender_type": "user", "sender_id": "u-gone", "content": "old message", "created_at": "4"},
        {"thread_id": "private", "sender_type": "user", "sender_id": "u-bob", "content": "how many members?", "created_at": "5"},
    ],
)


@pytest.fixture(autouse=True)
def fake_backend():
    captured: dict = {}

    class FakeMessages:
        @contextmanager
        def stream(self, **kwargs):
            captured.update(kwargs)
            yield types.SimpleNamespace(text_stream=iter(()))

    fake_anthropic = types.SimpleNamespace(Anthropic=lambda **_: types.SimpleNamespace(messages=FakeMessages()))
    with (
        patch.object(llm, "get_db", return_value=DB),
        patch.object(llm, "get_api_key", return_value="sk-test"),
        patch.object(llm, "_fetch_user_name", side_effect=NAMES.get),
        patch.dict(sys.modules, {"anthropic": fake_anthropic}),
    ):
        yield captured


def _run(thread_id: str, user_id: str) -> None:
    list(llm.stream_ai_response(thread_id, user_id, "anthropic", "claude-haiku-4-5", "client-sent-name"))


def test_roster_lists_every_member_with_role_in_join_order():
    roster = llm._fetch_team_roster("team-1")
    assert [(m["name"], m["role"]) for m in roster] == [("Venu", "owner"), ("Bob", "member"), ("Quiet Priya", "member")]


def test_shared_thread_prompt_includes_whole_team_and_labels_each_sender(fake_backend):
    _run("shared", "u-bob")

    system = fake_backend["system"]
    assert "TEAM MEMBERS (3): Venu (owner); Bob (member) - the person you are talking to; Quiet Priya (member)." in system
    assert "You are currently talking to: Bob" in system

    turns = [(m["role"], m["content"]) for m in fake_backend["messages"]]
    assert ("user", "[Venu]: lets do frontend") in turns
    assert ("user", "[Bob]: yo gang") in turns
    assert ("assistant", "Hi team") in turns
    assert ("user", "[Former member]: old message") in turns


def test_private_thread_context_names_shared_thread_senders(fake_backend):
    _run("private", "u-bob")

    system = fake_backend["system"]
    assert "TEAM MEMBERS (3)" in system
    assert "Venu: lets do frontend" in system
    assert "Bob (you): yo gang" in system
    assert "Choir AI: Hi team" in system
    assert "Team Member:" not in system
    # Private turns stay unlabelled: only the owner writes there.
    assert fake_backend["messages"] == [{"role": "user", "content": "how many members?"}]


def test_forked_private_thread_tells_the_ai_which_message_is_the_focus(fake_backend):
    forked = {"id": "forked", "project_id": "p1", "type": "private", "owner_id": "u-bob", "forked_from_message_id": "m-venu"}
    shared_msg = {"id": "m-venu", "thread_id": "shared", "sender_type": "user", "sender_id": "u-owner", "content": "lets do frontend", "created_at": "1"}
    db = FakeClient(
        teams=DB._tables["teams"],
        projects=DB._tables["projects"],
        team_members=DB._tables["team_members"],
        threads=[*DB._tables["threads"], forked],
        messages=[shared_msg, *DB._tables["messages"][1:]],
    )
    with patch.object(llm, "get_db", return_value=db):
        _run("forked", "u-bob")

    system = fake_backend["system"]
    assert "FOCUS: The user started this private thread to discuss one message from the shared thread, written by Venu:" in system
    assert '"""\nlets do frontend\n"""' in system
    assert "Treat that message as the focus of this conversation." in system


def test_focus_is_skipped_for_unforked_threads_and_unknown_messages():
    assert llm._fork_focus_context({"id": "t"}, [], NAMES) == ""
    # A message that isn't in this project's shared thread is never pulled in.
    assert llm._fork_focus_context({"forked_from_message_id": "elsewhere"}, [{"id": "m1", "content": "x"}], NAMES) == ""


def test_shared_from_private_is_attributed():
    msgs = llm._to_chat_messages(
        [{"sender_type": "user", "sender_id": "u-bob", "content": "Schema draft", "shared_by": "u-bob"}], NAMES
    )
    assert msgs == [{"role": "user", "content": "[Bob, shared from their private thread]\nSchema draft"}]


def test_display_name_matches_frontend_order():
    user = types.SimpleNamespace(user_metadata={"name": "Google Name", "full_name": "Saved Name"}, email="x@y.com")
    assert llm._display_name(user) == "Saved Name"
    assert llm._display_name(types.SimpleNamespace(user_metadata={}, email="venu@example.com")) == "venu"
