"""
Component #4: project memory (backend/src/backend/memory.py). Fakes only.

- built from Team Space only, and only after enough new messages (unless forced);
- every AI note must cite a message it was actually shown; anything else is dropped;
- notes a person wrote are never changed or removed by the AI;
- a person's edit landing during an update is kept (version check + retry);
- notes citing a post withdrawn during an update are dropped after the write;
- a reply the model garbles leaves the old memory untouched.
"""

import json
from datetime import datetime, timezone
from unittest.mock import patch

from backend import llm, memory
from tests.fakes import FakeClient


def at(i: int) -> str:
    return f"2026-01-05T00:{i // 60:02d}:{i % 60:02d}+00:00"


def team_space(n: int, start: int = 0) -> list[dict]:
    return [
        {"id": f"m{i}", "thread_id": "ts", "sender_type": "user", "sender_id": "u-a", "content": f"note {i}", "created_at": at(i)}
        for i in range(start, start + n)
    ]


def world(messages: list[dict], memory_row: dict | None = None, private: list[dict] | None = None) -> FakeClient:
    return FakeClient(
        threads=[
            {"id": "ts", "project_id": "p", "type": "shared"},
            {"id": "priv", "project_id": "p", "type": "private", "owner_id": "u-a"},
        ],
        messages=messages + (private or []),
        project_memory=[memory_row] if memory_row else [],
    )


PERSON_NOTE = {"id": "n-person", "section": "facts", "text": "Budget is 40 dollars", "sources": ["m0"], "by": "u-b"}


def run(db: FakeClient, reply, force: bool = False) -> dict | None:
    side_effect = reply if callable(reply) else (lambda *a, **k: reply)
    with patch.object(llm, "get_db", return_value=db), patch.object(llm, "complete_once", side_effect=side_effect) as model:
        row = memory.refresh("p", "anthropic", "m", "k", {"u-a": "Priya"}, force=force)
    run.calls = model.call_count  # type: ignore[attr-defined]
    return row


def test_waits_for_enough_new_messages_unless_forced():
    db = world(team_space(3))
    assert run(db, "[]") is None and run.calls == 0  # type: ignore[attr-defined]
    run(db, "[]", force=True)
    assert run.calls == 1  # type: ignore[attr-defined]


def test_ai_notes_must_cite_messages_it_was_shown():
    reply = json.dumps([
        {"id": "new", "section": "goal", "text": "A plant monitor", "sources": ["m1"]},
        {"id": "new", "section": "facts", "text": "Invented fact", "sources": ["m999"]},
        {"id": "new", "section": "facts", "text": "No source", "sources": []},
        {"id": "new", "section": "nonsense", "text": "Bad section", "sources": ["m1"]},
    ])
    row = run(world(team_space(10)), reply)
    assert [(n["section"], n["text"], n["by"]) for n in row["items"]] == [("goal", "A plant monitor", "ai")]
    assert row["covers_through"] == at(9) and row["version"] == 1


def test_private_threads_never_feed_memory():
    prompts: list[str] = []
    db = world(team_space(10), private=[
        {"id": "secret", "thread_id": "priv", "sender_type": "user", "sender_id": "u-a", "content": "my private plan", "created_at": at(50)},
    ])
    run(db, lambda p, m, k, system, prompt, max_tokens: prompts.append(prompt) or "[]")
    assert "my private plan" not in prompts[0] and "note 9" in prompts[0]


def test_person_written_notes_are_kept_whatever_the_ai_returns():
    row = run(
        world(team_space(10), {"project_id": "p", "items": [PERSON_NOTE], "version": 3, "covers_through": None}),
        json.dumps([{"id": "n-person", "section": "facts", "text": "Budget is 90 dollars", "sources": ["m1"]}]),
    )
    person = [n for n in row["items"] if n["by"] == "u-b"]
    assert person == [PERSON_NOTE]
    # The AI can't take over a person's note by reusing its id.
    assert all(n["id"] != "n-person" for n in row["items"] if n["by"] == "ai")


def test_an_edit_during_the_update_is_kept():
    db = world(team_space(10), {"project_id": "p", "items": [], "version": 1, "covers_through": None})

    def someone_edits_meanwhile(*_args, **_kwargs):
        db._tables["project_memory"][0].update(items=[PERSON_NOTE], version=2)
        return json.dumps([{"id": "new", "section": "goal", "text": "A plant monitor", "sources": ["m1"]}])

    row = run(db, someone_edits_meanwhile)
    assert PERSON_NOTE in row["items"] and row["version"] == 3
    assert any(n["text"] == "A plant monitor" for n in row["items"])


def test_notes_citing_a_post_withdrawn_during_the_update_are_dropped():
    messages = team_space(10)
    db = world(messages)

    def withdraw_mid_update(*_args, **_kwargs):
        messages[4].update(content="", withdrawn_at=datetime.now(timezone.utc).isoformat())
        return json.dumps([
            {"id": "new", "section": "facts", "text": "From the withdrawn post", "sources": ["m4"]},
            {"id": "new", "section": "goal", "text": "A plant monitor", "sources": ["m1"]},
        ])

    row = run(db, withdraw_mid_update)
    assert [n["text"] for n in row["items"]] == ["A plant monitor"]


def test_a_slower_older_update_never_overwrites_a_newer_one():
    # Codex review: overlapping updates let the older one restore stale notes and move
    # coverage backwards.
    db = world(team_space(10))

    def newer_update_lands_first(*_args, **_kwargs):
        db._tables["project_memory"].append({
            "project_id": "p", "version": 5, "covers_through": at(50),
            "items": [{"id": "new", "section": "facts", "text": "Budget is 45 dollars", "sources": ["m9"], "by": "ai"}],
        })
        return json.dumps([{"id": "old", "section": "facts", "text": "Budget is 40 dollars", "sources": ["m1"]}])

    row = run(db, newer_update_lands_first)
    stored = db._tables["project_memory"][0]
    assert stored["covers_through"] == at(50) and stored["version"] == 5
    assert [n["text"] for n in stored["items"]] == ["Budget is 45 dollars"]
    assert row == stored


def test_a_garbled_reply_keeps_the_old_memory():
    old = {"project_id": "p", "items": [PERSON_NOTE], "version": 2, "covers_through": None}
    db = world(team_space(10), old)
    assert run(db, "Sorry, I can't do that.") == old
    assert db._tables["project_memory"][0]["version"] == 2


def test_render_groups_by_section_and_marks_ai_notes():
    db = world([], {"project_id": "p", "version": 1, "items": [
        {"id": "a", "section": "goal", "text": "A plant monitor", "sources": ["m1"], "by": "ai"},
        PERSON_NOTE,
    ]})
    with patch.object(llm, "get_db", return_value=db):
        text = memory.render("p", 5_000)
    assert "What we're building:\n- A plant monitor (AI)" in text
    assert "Facts and constraints:\n- Budget is 40 dollars\n" in text + "\n"
    with patch.object(llm, "get_db", return_value=world([])):
        assert memory.render("p", 5_000) == ""
