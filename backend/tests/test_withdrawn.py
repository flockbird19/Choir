"""
A withdrawn publication (withdraw_publication() in schema.sql) never reaches an AI
prompt, Catch me up or an export. No real model or database is used.
"""

from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from backend import llm
from backend.auth import get_current_user
from tests.fakes import FakeClient

DB = FakeClient(
    threads=[{"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None, "name": "Team Space"}],
    projects=[{"id": "p1", "team_id": "t1"}],
    team_members=[{"team_id": "t1", "user_id": "u-me", "role": "owner", "joined_at": "1"}],
    profiles=[{"id": "u-me", "display_name": "Priya"}],
    messages=[
        {"id": "a", "thread_id": "shared", "sender_type": "user", "sender_id": "u-me", "content": "Kept", "created_at": "1"},
        {"id": "b", "thread_id": "shared", "sender_type": "user", "sender_id": "u-me", "content": "",
         "shared_by": "u-me", "source_thread_id": "private", "withdrawn_at": "3", "created_at": "2"},
    ],
)


def test_ai_context_and_catch_me_up_skip_withdrawn_posts():
    with patch.object(llm, "get_db", return_value=DB):
        assert [m["id"] for m in llm._fetch_messages("shared")] == ["a"]
        assert [m["id"] for m in llm._fetch_messages_since("shared", None)] == ["a"]
        assert [m["id"] for m in llm._fetch_messages_since("shared", "0")] == ["a"]


def test_markdown_export_shows_a_withdrawn_placeholder():
    main.app.dependency_overrides[get_current_user] = lambda: "u-me"
    try:
        with (
            patch.object(main, "verify_thread_access", return_value=True),
            patch.object(main, "get_db", return_value=DB),
            patch.object(llm, "get_db", return_value=DB),
        ):
            text = TestClient(main.app).get("/api/export/shared?format=md").text
    finally:
        main.app.dependency_overrides.clear()
    assert "Kept" in text
    assert "_Withdrew a post._" in text
    assert "Published from" not in text


def test_a_summary_written_while_a_post_is_withdrawn_is_not_kept():
    # Codex review P1: withdraw_publication() deletes the stored summary, but a summary that was
    # already being generated would be written back afterwards, withdrawn text included.
    msgs = [
        {"id": f"m{i}", "thread_id": "t", "sender_type": "user", "sender_id": "u", "content": f"msg {i}", "created_at": f"2026-09-29T00:00:{i:02d}Z"}
        for i in range(25)
    ]
    db = FakeClient(messages=msgs, thread_summaries=[])

    def withdraw_mid_generation(*_args, **_kwargs):
        msgs[3].update(content="", withdrawn_at=datetime.now(timezone.utc).isoformat())
        return "summary mentioning msg 3"

    with patch.object(llm, "get_db", return_value=db), patch.object(llm, "complete_once", side_effect=withdraw_mid_generation):
        result = llm._refresh_summary_if_needed("t", msgs, {}, "anthropic", "m", "k")

    assert result == ""
    assert db.table("thread_summaries").select("*").execute().data == []


def test_a_summary_with_no_withdrawal_is_kept():
    msgs = [{"id": "m1", "thread_id": "t", "sender_type": "user", "sender_id": "u", "content": "hi", "created_at": "2026-09-29T00:00:00Z"}]
    db = FakeClient(messages=msgs, thread_summaries=[])
    with patch.object(llm, "get_db", return_value=db), patch.object(llm, "complete_once", return_value="kept"):
        assert llm._refresh_summary_if_needed("t", msgs, {}, "anthropic", "m", "k") == "kept"
    assert len(db.table("thread_summaries").select("*").execute().data) == 1
