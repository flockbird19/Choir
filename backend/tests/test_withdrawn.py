"""
A withdrawn publication (withdraw_publication() in schema.sql) never reaches an AI
prompt, Catch me up or an export. No real model or database is used.
"""

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
