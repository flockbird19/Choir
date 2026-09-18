"""
D3: prompt budget, rolling summaries (`thread_summaries`), and the FU-3 shared
one-shot completion helper (`llm.complete_once`) used by Catch Me Up and
Publish findings.
"""

from unittest.mock import patch

from backend import findings, llm
from tests.fakes import FakeClient


def _msg(i: int, content: str = "msg", **extra):
    return {
        "sender_type": "user",
        "sender_id": "u1",
        "content": f"{content} {i}",
        "created_at": f"2026-01-01T00:{i:02d}:00+00:00",
        **extra,
    }


def test_recent_window_caps_by_message_count():
    messages = [_msg(i) for i in range(50)]
    older, recent = llm._recent_window(messages)
    assert len(recent) == llm.MAX_CONTEXT_MESSAGES
    assert len(older) == 10
    assert recent[0] == messages[10]
    assert recent[-1] == messages[-1]


def test_recent_window_caps_by_chars_even_under_the_message_cap():
    messages = [_msg(i, content="x" * 5000) for i in range(5)]
    older, recent = llm._recent_window(messages)
    # 12,000-char budget: the 3rd-from-last message would push the total over.
    assert len(recent) == 2
    assert len(older) == 3


def test_recent_window_always_keeps_at_least_the_last_message():
    messages = [_msg(0, content="x" * 50_000)]
    older, recent = llm._recent_window(messages)
    assert recent == messages
    assert older == []


def test_budget_always_keeps_pinned_decisions_from_outside_the_window():
    old_decision = {**_msg(0, content="Decision: use Postgres"), "id": "d1", "is_decision": True}
    filler = [_msg(i) for i in range(1, 45)]
    messages = [old_decision, *filler]

    older, recent = llm._recent_window(messages)
    decisions = [m for m in older if m.get("is_decision")]
    kept = decisions + recent

    assert old_decision in kept
    assert old_decision not in recent  # it aged out of the verbatim window...
    assert old_decision in older  # ...but is still in `older`, so still gets kept


def test_summary_is_reused_when_too_few_messages_have_aged_out():
    older = [_msg(i) for i in range(5)]
    db = FakeClient(
        thread_summaries=[
            {
                "thread_id": "t1",
                "summary": "Existing summary",
                "covers_through": older[0]["created_at"],
                "message_count": 1,
            }
        ]
    )
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "complete_once") as mock_complete,
    ):
        result = llm._refresh_summary_if_needed("t1", older, {}, "anthropic", "m", "k")

    assert result == "Existing summary"
    mock_complete.assert_not_called()


def test_summary_refreshes_once_enough_new_material_has_aged_out_and_is_then_reused():
    older = [_msg(i) for i in range(25)]
    db = FakeClient(thread_summaries=[])

    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "complete_once", return_value="New rolling summary") as mock_complete,
    ):
        result = llm._refresh_summary_if_needed("t1", older, {}, "anthropic", "model-x", "key")

    assert result == "New rolling summary"
    mock_complete.assert_called_once()
    stored = db._tables["thread_summaries"][0]
    assert stored["covers_through"] == older[-1]["created_at"]
    assert stored["message_count"] == 25
    assert stored["model_provider"] == "anthropic"
    assert stored["model_name"] == "model-x"

    # Calling again with the same `older` (nothing new has aged out past
    # covers_through) reuses the stored summary instead of calling the model again.
    mock_complete.reset_mock()
    with patch.object(llm, "get_db", return_value=db), patch.object(llm, "complete_once", mock_complete):
        again = llm._refresh_summary_if_needed("t1", older, {}, "anthropic", "model-x", "key")
    assert again == "New rolling summary"
    mock_complete.assert_not_called()


def test_summary_refresh_failure_falls_back_to_the_stored_summary():
    older = [_msg(i) for i in range(25)]
    db = FakeClient(
        thread_summaries=[
            {"thread_id": "t1", "summary": "Old summary", "covers_through": "2020-01-01T00:00:00+00:00", "message_count": 1}
        ]
    )
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "complete_once", side_effect=RuntimeError("Rate limit reached")),
    ):
        result = llm._refresh_summary_if_needed("t1", older, {}, "anthropic", "m", "k")
    assert result == "Old summary"


def test_generate_digest_uses_the_shared_helper_and_stays_within_budget():
    many_messages = [
        {
            "thread_id": "shared",
            "sender_type": "user",
            "sender_id": "u1",
            "content": f"msg {i}",
            "created_at": f"2026-01-01T00:{i:02d}:00+00:00",
        }
        for i in range(50)
    ]
    db = FakeClient(
        threads=[{"id": "shared", "project_id": "p1", "type": "shared"}],
        projects=[{"id": "p1", "team_id": "team-1", "name": "P"}],
        team_members=[{"team_id": "team-1", "user_id": "u1", "role": "owner", "joined_at": "1"}],
        profiles=[{"id": "u1", "display_name": "Venu"}],
        messages=many_messages,
        # A `since` far before all 50 messages, so the digest sees every one of
        # them instead of the "never checked before" 30-message fallback — that's
        # what actually exercises the D3 budget trim below.
        thread_reads=[{"thread_id": "shared", "user_id": "u1", "last_seen_at": "2020-01-01T00:00:00+00:00"}],
    )
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "get_api_key", return_value="sk-test"),
        patch.object(llm, "complete_once", return_value="Digest summary") as mock_complete,
    ):
        result = llm.generate_digest("shared", "u1")

    assert result == {"summary": "Digest summary", "message_count": 50}
    mock_complete.assert_called_once()
    args, kwargs = mock_complete.call_args
    assert args[0] == "anthropic"
    assert kwargs["max_tokens"] == 512
    user_prompt = args[4]
    assert "msg 49" in user_prompt  # most recent: kept
    assert "msg 0" not in user_prompt  # aged out of the budget: dropped


def test_draft_findings_uses_the_same_shared_helper_as_digest():
    db = FakeClient(
        threads=[{"id": "t1", "project_id": "p1", "type": "private"}],
        messages=[{"thread_id": "t1", "sender_type": "user", "sender_id": "u1", "content": "hi", "created_at": "1"}],
    )
    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "get_api_key", return_value="sk-test"),
        patch.object(findings, "get_api_key", return_value="sk-test"),
        patch.object(findings, "complete_once", return_value="## Summary\nDraft") as mock_complete,
    ):
        result = findings.draft_findings("t1", "u1")

    assert result == {"draft": "## Summary\nDraft"}
    mock_complete.assert_called_once()
