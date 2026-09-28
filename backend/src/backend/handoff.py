"""
"Export as prompt": the AI rewrites a thread (plus the team's Decisions and project memory)
into a self-contained prompt the user can paste into Claude, ChatGPT or any other AI chat.

Nothing is saved; the user reviews and copies the text in the browser.
"""

from typing import Any

from backend import llm, memory, prompts
from backend.findings import coverage_line
from backend.llm import (
    NoApiKeyError,
    _fetch_thread,
    _resolve_provider_and_model,
    complete_once,
    sender_label,
    team_names_for_thread,
)

HANDOFF_SYSTEM_PROMPT = prompts.system(prompts.HANDOFF_JOB)

def _transcript(messages: list[dict[str, Any]], names: dict[str, str], user_id: str) -> str:
    lines = []
    for msg in messages:
        label = sender_label(msg, names)
        if msg["sender_type"] != "assistant" and msg.get("sender_id") == user_id:
            label += " (me)"
        lines.append(f"{label}: {msg['content']}")
    return "\n\n".join(lines)


def draft_handoff_prompt(thread_id: str, user_id: str) -> dict[str, str]:
    """
    Returns {"prompt": text}. Uses the caller's own key, like Publish findings.
    Reads the thread the way the AI does (component #4): its compact summary plus the latest
    messages, every pinned Decision, and project memory.
    Raises ValueError (nothing to export), NoApiKeyError, or RuntimeError.
    """
    thread = _fetch_thread(thread_id)
    if not thread:
        raise ValueError("Thread not found.")

    if not llm._latest_message(thread_id):
        raise ValueError("This thread has no messages to turn into a prompt yet.")

    resolved = _resolve_provider_and_model(thread, user_id)
    if not resolved:
        raise NoApiKeyError(
            "No API key found. Please add one in Settings → API Keys before using Export as prompt."
        )
    provider, model, api_key = resolved

    names = team_names_for_thread(thread)
    tz = llm.user_tz(None)
    # Same budget as the AI chat; compact first rather than silently leave earlier messages out.
    view = llm.compact_until_it_fits(
        thread_id, None, llm.context_chars(provider) * 3 // 4, provider, model, api_key, names, tz
    )
    kind = "my private thread" if thread.get("type") == "private" else "our team's shared thread (Team Space)"
    parts = [f'This is "{thread.get("name") or "Untitled"}", {kind} in Choir, a team chat with an AI assistant ("Choir AI").']
    for block in (
        memory.render(thread["project_id"], 4_000),
        llm.decisions_block(llm._team_decisions(thread["project_id"]), names, tz, 6_000),
        llm.checkpoint_block(view["checkpoint"], "EARLIER IN THE THREAD", tz),
    ):
        if block:
            parts.append(block)
    parts.append(coverage_line(view))
    parts.append("THREAD:\n" + _transcript(view["messages"], names, user_id))

    prompt = complete_once(provider, model, api_key, HANDOFF_SYSTEM_PROMPT, "\n\n".join(parts), max_tokens=1200)
    return {"prompt": prompt.strip()}
