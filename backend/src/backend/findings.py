"""
K2 "Publish findings": drafts a short Team Space post from a private thread.

The draft is only a suggestion; the user edits it before anything is posted, and the
post itself is written by the frontend (postToSharedThread with source_thread_id).
"""

from typing import Any

from backend.handoff import _team_decisions
from backend.llm import (
    NoApiKeyError,
    _fetch_messages,
    _fetch_thread,
    _resolve_provider_and_model,
    complete_once,
)

FINDINGS_SYSTEM_PROMPT = (
    "You help a team member share what they worked out in their private AI thread with their team. "
    "Write a short Markdown post, in the first person, with exactly these three sections:\n"
    "## Summary\n2-4 sentences on what was explored and found.\n"
    "## Recommendation\nWhat the writer proposes the team does, as 1-3 bullet points.\n"
    "## Open questions\n1-3 bullet points the team should weigh in on. Write 'None' if there are none.\n"
    "HONESTY: Only claim what the thread actually reached. If the writer weighed several options without "
    "settling, say so and present them as options, not as one confident recommendation. Keep real "
    "uncertainty and disagreement visible.\n"
    "TEAM DECISIONS: If team Decisions are given, check the findings against them. When the findings agree "
    "with a Decision, you may say so briefly. When they point away from a Decision, say it plainly and "
    "name the Decision, for example: 'The team chose PostgreSQL; these findings suggest reconsidering "
    "because...'. Never bend the findings to fit a Decision, and never call a Decision wrong outright.\n"
    "STYLE: Plain and specific. Do NOT use emojis. No preamble or sign-off; output only the post. "
    "Keep it under 220 words."
)

MAX_TRANSCRIPT_CHARS = 24_000


def _recent_that_fit(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The most recent whole messages whose text fits the budget (always at least the latest)."""
    kept: list[dict[str, Any]] = []
    total = 0
    for msg in reversed(messages):
        size = len(msg["content"] or "") + 20
        if kept and total + size > MAX_TRANSCRIPT_CHARS:
            break
        kept.append(msg)
        total += size
    kept.reverse()
    return kept


def _transcript(messages: list[dict[str, Any]]) -> str:
    return "\n\n".join(
        f"{'Choir AI' if msg['sender_type'] == 'assistant' else 'Me'}: {msg['content']}" for msg in messages
    )[-MAX_TRANSCRIPT_CHARS:]


def draft_findings(thread_id: str, user_id: str) -> dict[str, Any]:
    """
    Returns {"draft": markdown, "source_message_ids": [...]}: the ids are exactly the messages
    the AI was shown, so the published post's trail (K3) never claims more than was used.
    Uses the caller's own key, like Catch Me Up.
    Raises ValueError (not a private thread / nothing to publish), NoApiKeyError, or RuntimeError.
    """
    thread = _fetch_thread(thread_id)
    if not thread or thread.get("type") != "private":
        raise ValueError("Findings can only be published from a private thread.")

    messages = _recent_that_fit(_fetch_messages(thread_id))
    if not messages:
        raise ValueError("This thread has no messages to publish yet.")

    resolved = _resolve_provider_and_model(thread, user_id)
    if not resolved:
        raise NoApiKeyError(
            "No API key found. Please add one in Settings → API Keys before using Publish findings."
        )
    provider, model, api_key = resolved

    parts = []
    decisions = _team_decisions(thread["project_id"])
    if decisions:
        parts.append("TEAM DECISIONS (pinned in Team Space):\n" + "\n".join(f"- {d['content'].strip()}" for d in decisions))
    parts.append(f"Here is my private thread:\n\n{_transcript(messages)}")

    draft = complete_once(provider, model, api_key, FINDINGS_SYSTEM_PROMPT, "\n\n".join(parts), max_tokens=700)
    return {"draft": draft.strip(), "source_message_ids": [m["id"] for m in messages]}
