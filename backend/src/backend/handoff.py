"""
"Export as prompt": the AI rewrites a thread (plus the team's Decisions) into a
self-contained prompt the user can paste into Claude, ChatGPT or any other AI chat.

Nothing is saved; the user reviews and copies the text in the browser.
"""

from typing import Any, cast

from backend.db import get_db
from backend.llm import (
    NoApiKeyError,
    _fetch_messages,
    _fetch_thread,
    _resolve_provider_and_model,
    complete_once,
    sender_label,
    team_names_for_thread,
)

HANDOFF_SYSTEM_PROMPT = (
    "You turn a team chat thread into a prompt that its reader will paste into a fresh AI chat "
    "(Claude, ChatGPT or similar) to carry on the work there. That new AI has seen nothing, so the "
    "prompt must stand on its own.\n"
    "Write it in the first person, as the reader talking to the new AI. Use these sections, as short "
    "bold labels, and leave out any section with nothing real to say:\n"
    "**Goal:** what I'm trying to get done, in one or two sentences.\n"
    "**Context:** the background the new AI needs: project, tools, constraints, who is involved.\n"
    "**Already decided:** team Decisions and conclusions reached in the thread. Treat these as settled.\n"
    "**What we've worked out:** findings, answers, approaches tried, and what was ruled out and why.\n"
    "**Still open:** unresolved questions or disagreements.\n"
    "**What I need from you:** the concrete next thing to help with, based on where the thread left off.\n"
    "RULES: Synthesize, never replay the conversation turn by turn. Keep every specific that matters "
    "(names, numbers, versions, file names, code, commands, links) exactly as written; put code in "
    "fenced blocks. Do not invent anything that isn't in the thread. No preamble, no sign-off, no "
    "emojis: output only the prompt. Keep it under 450 words unless code needs more room."
)

MAX_TRANSCRIPT_CHARS = 24_000


def _transcript(messages: list[dict[str, Any]], names: dict[str, str], user_id: str) -> str:
    lines = []
    for msg in messages:
        label = sender_label(msg, names)
        if msg["sender_type"] != "assistant" and msg.get("sender_id") == user_id:
            label += " (me)"
        lines.append(f"{label}: {msg['content']}")
    # Keep the most recent part if the thread is very long.
    return "\n\n".join(lines)[-MAX_TRANSCRIPT_CHARS:]


def _team_decisions(project_id: str) -> list[dict[str, Any]]:
    """Pinned Decisions in the project's Team Space, oldest first."""
    db = get_db()
    shared = cast(list[dict[str, Any]], (
        db.table("threads").select("id").eq("project_id", project_id).eq("type", "shared").execute()
    ).data)
    if not shared:
        return []
    return cast(list[dict[str, Any]], (
        db.table("messages").select("*")
        .eq("thread_id", shared[0]["id"]).eq("is_decision", True)
        .order("pinned_at")
        .execute()
    ).data)


def draft_handoff_prompt(thread_id: str, user_id: str) -> dict[str, str]:
    """
    Returns {"prompt": text}. Uses the caller's own key, like Publish findings.
    Raises ValueError (nothing to export), NoApiKeyError, or RuntimeError.
    """
    thread = _fetch_thread(thread_id)
    if not thread:
        raise ValueError("Thread not found.")

    messages = _fetch_messages(thread_id)
    if not messages:
        raise ValueError("This thread has no messages to turn into a prompt yet.")

    resolved = _resolve_provider_and_model(thread, user_id)
    if not resolved:
        raise NoApiKeyError(
            "No API key found. Please add one in Settings → API Keys before using Export as prompt."
        )
    provider, model, api_key = resolved

    names = team_names_for_thread(thread)
    kind = "my private thread" if thread.get("type") == "private" else "our team's shared thread (Team Space)"
    parts = [f'This is "{thread.get("name") or "Untitled"}", {kind} in Choir, a team chat with an AI assistant ("Choir AI").']
    decisions = _team_decisions(thread["project_id"])
    if decisions:
        parts.append("TEAM DECISIONS (pinned in Team Space):\n" + "\n".join(f"- {d['content'].strip()}" for d in decisions))
    parts.append("THREAD:\n" + _transcript(messages, names, user_id))

    prompt = complete_once(provider, model, api_key, HANDOFF_SYSTEM_PROMPT, "\n\n".join(parts), max_tokens=1200)
    return {"prompt": prompt.strip()}
