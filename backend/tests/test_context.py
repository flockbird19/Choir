"""
Component #4: what the AI reads. Replaces the old rolling-summary tests (D3).

Guarantees checked here, all with fakes (no model, no database, no credits):
- nothing falls between a compact summary and the recent messages (no gap);
- a long thread is compacted into a visible checkpoint before it would drop anything;
- every pinned Decision is read, however old;
- old long AI replies are trimmed, the newest messages never are, and one huge message is cut;
- an answer is built from the thread as it stood at the message that asked, for its author;
- the message being replied to, today's date and message times are in the prompt;
- Catch me up reads every new message, condensing the older part instead of skipping it;
- a checkpoint written while a post is withdrawn is undone.
"""

import re
import sys
import types
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from backend import llm, memory
from tests.fakes import FakeClient


def at(i: int) -> str:
    # In the past, like real data: a checkpoint written "now" is newer than every message.
    return f"2026-01-05T{i // 3600:02d}:{i // 60 % 60:02d}:{i % 60:02d}+00:00"


def msg(i: int, thread: str = "t", sender: str | None = "u-a", text: str | None = None, **extra) -> dict:
    return {
        "id": f"m{i}", "thread_id": thread, "sender_type": "assistant" if sender is None else "user",
        "sender_id": sender, "content": text if text is not None else f"message {i}", "created_at": at(i), **extra,
    }


def world(messages: list[dict], **tables) -> FakeClient:
    return FakeClient(
        teams=[{"id": "team", "name": "Garden"}],
        projects=[{"id": "p", "team_id": "team", "name": "Monitor"}],
        team_members=[
            {"team_id": "team", "user_id": "u-a", "role": "owner", "joined_at": "1"},
            {"team_id": "team", "user_id": "u-b", "role": "member", "joined_at": "2"},
        ],
        profiles=[{"id": "u-a", "display_name": "Priya"}, {"id": "u-b", "display_name": "Arjun"}],
        threads=[
            {"id": "t", "project_id": "p", "type": "shared", "owner_id": None},
            {"id": "priv", "project_id": "p", "type": "private", "owner_id": "u-a"},
        ],
        messages=messages,
        **tables,
    )


def fake_fold(system: str, prompt: str) -> str:
    """A fake compaction model: the summary lists which messages it has seen."""
    body = prompt.split("NEW MESSAGES TO FOLD IN:\n")[1]
    seen = re.findall(r"\]: (message \d+)", body)
    previous = prompt.split("PREVIOUS SUMMARY:\n")[1].split("\n\n")[0]
    return ("" if previous == "(none yet)" else previous + "; ") + ", ".join(seen)


# ── Budget and the no-gap rule ──────────────────────────────────────────────


def test_fit_keeps_newest_whole_and_trims_older_long_ai_replies():
    messages = [msg(0, sender=None, text="A" * 5000)] + [msg(i) for i in range(1, 12)]
    kept, dropped = llm._fit(messages, 100_000)
    assert not dropped
    assert len(kept[0]["content"]) < 2000 and "trimmed" in kept[0]["content"]
    assert all(m["content"] == f"message {m['id'][1:]}" for m in kept[1:])


def test_one_huge_newest_message_is_cut_to_the_budget():
    kept, _ = llm._fit([msg(1, text="x" * 50_000)], 12_000)
    assert len(kept) == 1 and len(kept[0]["content"]) < 13_000


def test_thread_view_reports_overflow_instead_of_silently_dropping():
    db = world([msg(i, text="y" * 900) for i in range(60)])
    with patch.object(llm, "get_db", return_value=db):
        view = llm.thread_view("t", None, 12_000)
    assert view["overflow"] is True
    assert view["messages"][-1]["id"] == "m59"


def test_auto_compact_leaves_no_message_uncovered():
    messages = [msg(i, text=f"message {i} " + "z" * 800) for i in range(60)]
    db = world(list(messages))  # the checkpoint is appended to the fake table, not to `messages`
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "complete_once", side_effect=lambda p, m, k, system, prompt, max_tokens: fake_fold(system, prompt)),
    ):
        view = llm.compact_until_it_fits("t", None, 20_000, "anthropic", "m", "k", {"u-a": "Priya"}, timezone.utc)

    checkpoint = view["checkpoint"]
    assert checkpoint and checkpoint["kind"] == "checkpoint" and checkpoint["sender_id"] is None
    assert view["overflow"] is False
    kept_ids = {m["id"] for m in view["messages"]}
    covered = {m["id"] for m in messages if m["created_at"] <= checkpoint["covers_through"]}
    # Every message is either summarised by the checkpoint or read word for word.
    assert covered | kept_ids == {m["id"] for m in messages}
    assert checkpoint["covers_count"] == len(covered)
    for i in sorted(covered, key=lambda x: int(x[1:])):
        assert f"message {i[1:]}" in checkpoint["content"]


def test_a_second_compaction_folds_only_what_is_new():
    messages = [msg(i) for i in range(10)]
    db = world(messages + [{
        "id": "cp1", "thread_id": "t", "sender_type": "assistant", "kind": "checkpoint",
        "content": "earlier stuff", "covers_through": at(4), "covers_count": 5, "created_at": at(5) + "x",
    }])
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "complete_once", side_effect=lambda p, m, k, system, prompt, max_tokens: fake_fold(system, prompt)),
    ):
        checkpoint = llm.compact_thread("t", "anthropic", "m", "k", {}, timezone.utc, keep_from=at(8))
    assert checkpoint["content"].startswith("earlier stuff; ")
    assert "message 5" in checkpoint["content"] and "message 4" not in checkpoint["content"]
    assert "message 8" not in checkpoint["content"]
    assert checkpoint["covers_through"] == at(7) and checkpoint["covers_count"] == 8


def test_undone_checkpoints_and_withdrawn_posts_are_never_read_as_messages():
    db = world([
        msg(1), msg(2, withdrawn_at="x"),
        {"id": "cp", "thread_id": "t", "sender_type": "assistant", "kind": "checkpoint", "content": "old",
         "covers_through": at(0), "created_at": at(3), "withdrawn_at": "undone"},
        msg(4),
    ])
    with patch.object(llm, "get_db", return_value=db):
        view = llm.thread_view("t", None, 50_000)
    assert view["checkpoint"] is None
    assert [m["id"] for m in view["messages"]] == ["m1", "m4"]


def test_groq_gets_a_smaller_budget():
    assert llm.context_chars("groq") < llm.context_chars("anthropic")


# ── Decisions, time and the question being answered ───────────────────────


def test_every_pinned_decision_is_read_however_old():
    old = msg(0, text="We use Postgres.", is_decision=True, pinned_at=at(1))
    db = world([old] + [msg(i) for i in range(1, 500)])
    with patch.object(llm, "get_db", return_value=db):
        block = llm.decisions_block(llm._team_decisions("p"), {"u-a": "Priya"}, timezone.utc, 5_000)
    assert "We use Postgres." in block and "Priya" in block


def test_decisions_that_dont_fit_are_counted_not_hidden():
    decisions = [msg(i, text="d" * 300, is_decision=True, pinned_at=at(i)) for i in range(20)]
    block = llm.decisions_block(decisions, {}, timezone.utc, 1_000)
    assert "older Decisions not shown" in block


def test_times_show_in_the_users_time_zone():
    india = llm.user_tz(-330)
    assert llm.when("2026-09-29T08:30:00+00:00", india) == "Tue 29 Sep 14:00"
    assert "UTC+05:30" in llm.today_line(india)


@pytest.fixture
def captured():
    seen: dict = {}

    class FakeMessages:
        @contextmanager
        def stream(self, **kwargs):
            seen.update(kwargs)
            yield types.SimpleNamespace(text_stream=iter(("ok",)))

    fake = types.SimpleNamespace(Anthropic=lambda **_: types.SimpleNamespace(messages=FakeMessages()))
    with (
        patch.object(llm, "get_api_key", return_value="sk-test"),
        patch.dict(sys.modules, {"anthropic": fake}),
        patch.object(memory, "refresh_in_background"),
    ):
        yield seen


def _system(seen: dict) -> str:
    return "\n".join(block["text"] for block in seen["system"])


def test_answer_is_built_from_the_thread_as_it_stood_at_the_asking_message(captured):
    db = world([
        msg(1, sender="u-b", text="Arjun asks about pumps"),
        msg(2, sender="u-a", text="Priya asks about sensors"),
        msg(3, sender="u-b", text="Arjun asks something newer"),
    ])
    with patch.object(llm, "get_db", return_value=db):
        list(llm.stream_ai_response("t", "u-a", message_id="m2", tz_offset=0))
    turns = [m["content"] for m in captured["messages"]]
    assert turns[-1].endswith("Priya asks about sensors")
    assert not any("newer" in t for t in turns)
    assert "You are answering Priya's latest message" in _system(captured)


def test_you_cannot_ask_on_someone_elses_message(captured):
    db = world([msg(1, sender="u-b")])
    with patch.object(llm, "get_db", return_value=db):
        frames = list(llm.stream_ai_response("t", "u-a", message_id="m1"))
    assert "only ask the AI about your own message" in frames[0]
    assert captured == {}


def test_reply_target_date_and_decisions_are_in_the_prompt(captured):
    db = world([
        msg(1, sender="u-b", text="Old idea: use a peristaltic pump", is_decision=True, pinned_at=at(2)),
        *[msg(i) for i in range(2, 6)],
        msg(6, sender="u-a", text="is this still right?", reply_to_message_id="m1"),
    ])
    with patch.object(llm, "get_db", return_value=db):
        list(llm.stream_ai_response("t", "u-a", message_id="m6", tz_offset=-330))
    system = _system(captured)
    assert "reply to this earlier message from Arjun" in system and "peristaltic pump" in system
    assert "Today is" in system and "UTC+05:30" in system
    assert "TEAM DECISIONS" in system
    assert "Formal Decision: an item identified as pinned by application metadata" in system  # prompts.EVIDENCE


def test_long_thread_is_compacted_before_answering_and_says_so(captured):
    db = world([msg(i, text=f"message {i} " + "q" * 900) for i in range(90)])
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "complete_once", side_effect=lambda p, m, k, system, prompt, max_tokens: fake_fold(system, prompt)),
    ):
        frames = list(llm.stream_ai_response("t", "u-a", message_id="m89"))
    assert '"status": "compacting"' in frames[0]
    assert any(m.get("kind") == "checkpoint" for m in db._tables["messages"])
    # Codex review: the card written for this answer must reach this answer, even though it
    # was created after the question. The earliest message has to be in the prompt somewhere.
    system = _system(captured)
    assert "EARLIER IN TEAM SPACE" in system and "message 0," in system


def test_findings_and_export_compact_instead_of_dropping_early_messages():
    # Codex review: both used to read only the latest ~24k characters and say nothing.
    from backend import findings, handoff

    messages = [msg(0, thread="priv", text="message 0 REQUIREMENT: runs on batteries")] + [
        msg(i, thread="priv", text=f"message {i} " + "r" * 1500) for i in range(1, 90)
    ]
    for module, call in ((findings, findings.draft_findings), (handoff, handoff.draft_handoff_prompt)):
        db = world(list(messages))
        seen: list[str] = []
        with (
            patch.object(llm, "get_db", return_value=db),
            patch.object(llm, "get_api_key", return_value="sk"),
            patch.object(llm, "complete_once", side_effect=lambda p, m, k, system, prompt, max_tokens: fake_fold(system, prompt)),
            patch.object(module, "complete_once", side_effect=lambda p, m, k, system, prompt, max_tokens: seen.append(prompt) or "ok"),
        ):
            call("priv", "u-a")
        assert "message 0" in seen[0], module.__name__
        assert any(m.get("kind") == "checkpoint" for m in db._tables["messages"])


def test_private_thread_reads_project_memory_but_team_space_only_read_only(captured):
    db = world(
        [msg(1, thread="t", sender="u-b", text="team says hi"), msg(2, thread="priv", sender="u-a", text="my question")],
        project_memory=[{"project_id": "p", "items": [{"id": "n1", "section": "goal", "text": "A plant monitor", "sources": ["m1"], "by": "ai"}], "version": 1}],
    )
    with patch.object(llm, "get_db", return_value=db):
        list(llm.stream_ai_response("priv", "u-a", message_id="m2"))
    system = _system(captured)
    assert "PROJECT MEMORY" in system and "A plant monitor (AI)" in system
    assert "TEAM SPACE (read-only" in system and "team says hi" in system


# ── Catch me up and withdrawals ─────────────────────────────────────────────


def test_catch_me_up_condenses_the_middle_instead_of_skipping_it():
    messages = [msg(i, text=f"message {i} " + "w" * 1500) for i in range(1, 80)]
    db = world(messages, thread_reads=[{"thread_id": "t", "user_id": "u-a", "last_seen_at": at(0)}])
    prompts: list[str] = []

    def fake(p, m, k, system, prompt, max_tokens):
        prompts.append(prompt)
        return fake_fold(system, prompt) if "FOLD IN" in prompt else "digest"

    with patch.object(llm, "get_db", return_value=db), patch.object(llm, "get_api_key", return_value="sk"), patch.object(llm, "complete_once", side_effect=fake):
        result = llm.generate_digest("t", "u-a")
    assert result["message_count"] == 79
    final = prompts[-1]
    assert "EARLIER NEW MESSAGES (condensed)" in final and "message 1," in final
    assert "message 79" in final


def test_a_checkpoint_written_while_a_post_is_withdrawn_is_undone():
    messages = [msg(i) for i in range(6)]
    db = world(messages)

    def withdraw_mid_fold(p, m, k, system, prompt, max_tokens):
        messages[2].update(content="", withdrawn_at=datetime.now(timezone.utc).isoformat())
        return "summary mentioning message 2"

    with patch.object(llm, "get_db", return_value=db), patch.object(llm, "complete_once", side_effect=withdraw_mid_fold):
        result = llm.compact_thread("t", "anthropic", "m", "k", {}, timezone.utc, keep_from=None)
    assert result is None
    checkpoints = [m for m in db._tables["messages"] if m.get("kind") == "checkpoint"]
    assert len(checkpoints) == 1 and checkpoints[0]["withdrawn_at"]
    with patch.object(llm, "get_db", return_value=db):
        assert llm._latest_checkpoint("t") is None


def test_manual_compact_keeps_the_last_few_messages_word_for_word():
    db = world([msg(i, text=f"message {i} " + "k" * 1000) for i in range(80)])
    thread = {"id": "t", "project_id": "p", "type": "shared"}
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "resolve_key", return_value=("anthropic", "m", "k")),
        patch.object(llm, "complete_once", side_effect=lambda p, m, k, system, prompt, max_tokens: fake_fold(system, prompt)),
    ):
        checkpoint = llm.compact_now(thread, "u-b", "the pump wiring", 0)
    assert checkpoint["sender_id"] == "u-b"
    assert checkpoint["covers_through"] == at(75) and checkpoint["covers_count"] == 76


def test_compact_refuses_while_the_whole_thread_still_fits():
    # A 10-message thread was once compacted and lost an option the AI then denied suggesting.
    db = world([msg(i) for i in range(10)])
    thread = {"id": "t", "project_id": "p", "type": "shared"}
    with patch.object(llm, "get_db", return_value=db), patch.object(llm, "resolve_key", return_value=("anthropic", "m", "k")):
        with pytest.raises(ValueError, match="Nothing worth compacting yet"):
            llm.compact_now(thread, "u-a", None, 0)


def test_the_real_messages_win_over_a_card_while_everything_fits():
    long_ai = msg(1, sender=None, text="Options: TimescaleDB, InfluxDB and Apache IoTDB. " + "detail " * 400)
    messages = [msg(0), long_ai] + [msg(i) for i in range(2, 14)] + [{
        "id": "cp", "thread_id": "t", "sender_type": "assistant", "kind": "checkpoint",
        "content": "## Goal\n- a database (IoTDB lost here)", "covers_through": at(8), "covers_count": 9, "created_at": at(9),
    }]
    with patch.object(llm, "get_db", return_value=world(messages)):
        view = llm.thread_view("t", None, 60_000)
    assert view["checkpoint"] is None
    kept = {m["id"]: m for m in view["messages"]}
    assert "m0" in kept and kept["m1"]["content"] == long_ai["content"]  # whole, untrimmed
    assert "Apache IoTDB" in kept["m1"]["content"]


def test_no_pinned_decisions_is_said_outright():
    block = llm.decisions_block([], {}, timezone.utc, 5_000)
    assert block.startswith("TEAM DECISIONS: none pinned yet.") and "not a pin" in block
