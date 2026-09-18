"""
K2 "Publish findings": drafts a short Team Space post from a private thread.

The draft is only a suggestion; the user edits it before anything is posted, and the
post itself is written by the frontend (postToSharedThread with source_thread_id).
"""

from typing import Any

from backend.keys import get_api_key
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
    "STYLE: Plain and specific. Do NOT use emojis. No preamble or sign-off; output only the post. "
    "Keep it under 200 words."
)

MAX_TRANSCRIPT_CHARS = 24_000


def _transcript(messages: list[dict[str, Any]]) -> str:
    lines = [
        f"{'Choir AI' if msg['sender_type'] == 'assistant' else 'Me'}: {msg['content']}" for msg in messages
    ]
    text = "\n\n".join(lines)
    # Keep the most recent part if the thread is very long.
    return text[-MAX_TRANSCRIPT_CHARS:]


def draft_findings(thread_id: str, user_id: str) -> dict[str, str]:
    """
    Returns {"draft": markdown}. Uses the caller's own key, like Catch Me Up.
    Raises ValueError (not a private thread / nothing to publish), NoApiKeyError, or RuntimeError.
    """
    thread = _fetch_thread(thread_id)
    if not thread or thread.get("type") != "private":
        raise ValueError("Findings can only be published from a private thread.")

    messages = _fetch_messages(thread_id)
    if not messages:
        raise ValueError("This thread has no messages to publish yet.")

    resolved = _resolve_provider_and_model(thread, user_id)
    if not resolved:
        raise NoApiKeyError(
            "No API key found. Please add one in Settings → API Keys before using Publish findings."
        )
    provider, model = resolved
    api_key = get_api_key(user_id, provider)
    if not api_key:
        raise NoApiKeyError(f"Could not retrieve API key for {provider}.")

    user_prompt = f"Here is my private thread:\n\n{_transcript(messages)}"
    draft = complete_once(provider, model, api_key, FINDINGS_SYSTEM_PROMPT, user_prompt, max_tokens=700)
    return {"draft": draft.strip()}
