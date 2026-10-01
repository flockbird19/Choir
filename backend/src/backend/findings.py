"""
K2 "Publish findings": drafts a short Team Space post from a private thread.

The draft is only a suggestion; the user edits it before anything is posted, and the
post itself is written by the frontend (postToSharedThread with source_thread_id).
"""

from typing import Any

from backend import llm, memory, prompts
from backend.llm import NoApiKeyError, _fetch_thread, _resolve_provider_and_model, complete_once

FINDINGS_SYSTEM_PROMPT = prompts.system(prompts.FINDINGS_JOB)


def coverage_line(view: dict[str, Any]) -> str:
    """What the helper was given (prompts: helpers must know their coverage)."""
    checkpoint = view.get("checkpoint")
    latest = len(view["messages"])
    if checkpoint:
        return (
            f"COVERAGE: the whole thread: its first {checkpoint.get('covers_count') or 'earlier'} messages as the "
            f"compact summary above, then the latest {latest} word for word."
        )
    return f"COVERAGE: the whole thread, all {latest} messages word for word."


def draft_findings(thread_id: str, user_id: str) -> dict[str, Any]:
    """
    Returns {"draft": markdown, "source_message_ids": [...]}: the ids are exactly the messages
    the AI was shown word for word, so the published post's trail (K3) never claims more than
    was used. Uses the caller's own key, like Catch Me Up.
    Raises ValueError (not a private thread / nothing to publish), NoApiKeyError, or RuntimeError.
    """
    thread = _fetch_thread(thread_id)
    if not thread or thread.get("type") != "private":
        raise ValueError("Findings can only be published from a private thread.")

    if not llm._latest_message(thread_id):
        raise ValueError("This thread has no messages to publish yet.")

    resolved = _resolve_provider_and_model(thread, user_id)
    if not resolved:
        raise NoApiKeyError(
            "No API key found. Please add one in Settings → API Keys before using Publish findings."
        )
    provider, model, api_key = resolved

    names = llm.team_names_for_thread(thread)
    tz = llm.user_tz(None)
    # Read the thread the way the AI chat does, with its budget, and compact first rather than
    # silently leave earlier messages out (codex review).
    view = llm.compact_until_it_fits(
        thread_id, None, llm.context_chars(provider) * 3 // 4, provider, model, api_key, names, tz
    )
    messages = view["messages"]

    parts = [
        memory.render(thread["project_id"], 4_000),
        llm.decisions_block(llm._team_decisions(thread["project_id"]), names, tz, 4_000),
        llm.checkpoint_block(view["checkpoint"], "EARLIER IN MY PRIVATE THREAD", tz),
        coverage_line(view),
        "Here is my private thread:\n\n",
    ]
    # Each message carries its opened files, as in the chat.
    user_prompt = llm.with_files(
        "\n\n".join(part for part in parts if part),
        messages,
        lambda m: f"{'Choir AI' if m['sender_type'] == 'assistant' else 'Me'}: {m['content']}",
        provider,
    )

    draft = complete_once(provider, model, api_key, FINDINGS_SYSTEM_PROMPT, user_prompt, max_tokens=700)
    return {"draft": draft.strip(), "source_message_ids": [m["id"] for m in messages]}
