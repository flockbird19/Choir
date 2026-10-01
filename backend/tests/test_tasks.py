"""Feature D stage 1: the task list in prompts, Catch me up, exports, memory and Suggest tasks. No real model or database."""

import sys
import types
from contextlib import contextmanager
from datetime import timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import main
from backend import llm, memory, prompts, tasks
from backend.auth import get_current_user
from tests.fakes import FakeClient

NAMES = {"u-priya": "Priya", "u-devon": "Devon"}
ROWS = [
    {"id": "t1", "project_id": "p1", "title": "Write the ETA story", "status": "open", "claimed_by": None,
     "created_at": "2026-10-01T10:00:00+00:00"},
    {"id": "t2", "project_id": "p1", "title": "Move routing to v2", "status": "claimed", "claimed_by": "u-priya",
     "claimed_at": "2026-10-01T11:00:00+00:00", "created_at": "2026-10-01T10:01:00+00:00"},
    {"id": "t3", "project_id": "p1", "title": "Choose the database", "status": "done", "claimed_by": "u-devon",
     "done_by": "u-devon", "done_at": "2026-10-01T12:00:00+00:00", "result": "Postgres on Supabase",
     "created_at": "2026-10-01T09:00:00+00:00"},
]  # fmt: skip


# ── The TASKS block ───────────────────────────────────────────────────────────


def test_block_lists_open_claimed_and_done_with_names():
    text = tasks.block(ROWS, NAMES, timezone.utc, 4000)
    assert text.startswith("TASKS")
    assert "Open: Write the ETA story" in text
    assert "Priya: Move routing to v2" in text
    assert "Done by Devon" in text and "Postgres on Supabase" in text


def test_block_says_so_when_there_are_no_tasks():
    assert "none yet" in tasks.block([], NAMES, timezone.utc, 4000)


def test_block_done_since_keeps_only_newly_done():
    text = tasks.block(ROWS, NAMES, timezone.utc, 4000, done_since="2026-10-01T13:00:00+00:00")
    assert "Choose the database" not in text
    assert "Move routing to v2" in text  # who's doing what is always current


def test_block_respects_the_budget():
    many = [{**ROWS[0], "id": f"t{i}", "title": f"Task number {i}"} for i in range(200)]
    text = tasks.block(many, NAMES, timezone.utc, 600)
    assert len(text) < 900 and "more not shown" in text


def test_a_former_member_is_named_as_such():
    text = tasks.block([{**ROWS[1], "claimed_by": "u-gone"}], NAMES, timezone.utc, 4000)
    assert "A former member: Move routing to v2" in text


def test_fetch_reads_only_the_projects_tasks():
    db = FakeClient(tasks=ROWS + [{**ROWS[0], "id": "other", "project_id": "p2"}])
    with patch.object(llm, "get_db", return_value=db):
        assert {r["id"] for r in tasks.fetch("p1")} == {"t1", "t2", "t3"}


def test_markdown_for_exports():
    assert tasks.markdown([], NAMES, timezone.utc) == ""
    md = tasks.markdown(ROWS, NAMES, timezone.utc)
    assert md.startswith("## Tasks") and "Priya: Move routing to v2" in md


def test_tasks_text_reads_the_list_for_a_project():
    with patch.object(tasks, "fetch", return_value=ROWS):
        assert "Move routing to v2" in llm.tasks_text("p1", NAMES, timezone.utc, 4000)


# ── Ownership comes from the task list, not chat ──────────────────────────────


def test_memory_drops_ai_notes_about_who_owns_what():
    kept = memory._validate(
        [
            {"id": "new", "section": "owners", "text": "Priya does routing", "sources": ["m1"]},
            {"id": "new", "section": "facts", "text": "Demo is Nov 5", "sources": ["m1"]},
        ],
        {"m1"},
        set(),
    )
    assert [n["section"] for n in kept] == ["facts"]


def test_prompts_say_where_ownership_comes_from():
    assert "## What got done" in prompts.DIGEST_JOB and "TASKS block" in prompts.DIGEST_JOB
    sections = prompts.MEMORY_JOB.split("Sections:")[1].split("Keep unaffected")[0]
    assert "owners:" not in sections
    assert "one of goal, facts, open." in prompts.MEMORY_JOB


# ── Suggest tasks ─────────────────────────────────────────────────────────────

SUGGEST_DB = FakeClient(
    threads=[
        {"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None},
        {"id": "private", "project_id": "p1", "type": "private", "owner_id": "u-me"},
    ],
    messages=[
        {"id": "m1", "thread_id": "shared", "sender_type": "user", "sender_id": "u-devon",
         "content": "We need an ETA story for the demo.", "created_at": "1"},
        {"id": "d1", "thread_id": "shared", "sender_type": "user", "sender_id": "u-priya",
         "content": "Demo on Nov 5.", "created_at": "2", "is_decision": True, "pinned_at": "3"},
    ],
    tasks=[{"id": "t1", "project_id": "p1", "title": "Move routing to v2", "status": "open", "claimed_by": None,
            "created_at": "0"}],
    project_memory=[],
)  # fmt: skip

AI_JSON = (
    '[{"title": "Write the ETA story", "details": "3 sentences", "sources": ["m1"]},'
    ' {"title": "move routing  to V2", "sources": ["m1"]},'
    ' {"title": "Record the demo", "sources": ["msg:d1", "nope"]},'
    ' {"title": "", "sources": ["m1"]}]'
)


@pytest.fixture
def client():
    main.app.dependency_overrides[get_current_user] = lambda: "u-me"
    with patch.object(main, "_check_and_record_rate_limit"):
        yield TestClient(main.app, raise_server_exceptions=False)
    main.app.dependency_overrides.clear()


def _fake_anthropic(captured: dict, text: str):
    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return types.SimpleNamespace(content=[types.SimpleNamespace(text=text)])

    return types.SimpleNamespace(Anthropic=lambda **kw: types.SimpleNamespace(messages=FakeMessages()))


@contextmanager
def _backend(captured: dict, text: str, has_access: bool = True, keys: dict[str, str] | None = None):
    keys = {"anthropic": "sk-test"} if keys is None else keys
    with (
        patch.object(main, "verify_thread_access", return_value=has_access),
        patch.object(llm, "get_db", return_value=SUGGEST_DB),
        patch.object(llm, "get_api_key", side_effect=lambda uid, p: keys.get(p) if uid == "u-me" else None),
        patch.dict(sys.modules, {"anthropic": _fake_anthropic(captured, text)}),
    ):
        yield


def test_suggest_returns_new_tasks_with_their_sources(client):
    captured: dict = {}
    with _backend(captured, AI_JSON):
        res = client.post("/api/tasks/suggest/shared")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [s["title"] for s in body["suggestions"]] == ["Write the ETA story", "Record the demo"]
    assert body["skipped"] == 1  # "move routing  to V2" is already on the list
    first, second = body["suggestions"]
    assert first["source_message_ids"] == ["m1"] and first["details"] == "3 sentences"
    assert second["source_decision_ids"] == ["d1"] and second["source_message_ids"] == []  # "nope" dropped
    # The AI was shown the current list so it doesn't repeat it.
    assert "Move routing to v2" in str(captured.get("messages"))


def test_suggest_only_from_team_space(client):
    with _backend({}, AI_JSON):
        assert client.post("/api/tasks/suggest/private").status_code == 400


def test_suggest_needs_access(client):
    with _backend({}, AI_JSON, has_access=False):
        assert client.post("/api/tasks/suggest/shared").status_code == 403


def test_suggest_needs_a_key(client):
    with _backend({}, AI_JSON, keys={}):
        res = client.post("/api/tasks/suggest/shared")
    assert res.status_code == 400 and "API key" in res.json()["detail"]


def test_suggest_survives_a_reply_that_is_not_json(client):
    with _backend({}, "Sorry, I can't."):
        res = client.post("/api/tasks/suggest/shared")
    assert res.status_code == 200 and res.json()["suggestions"] == []
