"""
K2 "Publish findings": drafts a short Team Space post from a private thread.

The draft is only a suggestion; the user edits it before anything is posted, and the
post itself is written by the frontend (postToSharedThread with source_thread_id).
"""

from typing import Any

from backend import llm, memory
from backend.llm import NoApiKeyError, _fetch_thread, _resolve_provider_and_model, complete_once

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
        "Here is my private thread:\n\n"
        + "\n\n".join(f"{'Choir AI' if m['sender_type'] == 'assistant' else 'Me'}: {m['content']}" for m in messages),
    ]
    user_prompt = "\n\n".join(part for part in parts if part)

    draft = complete_once(provider, model, api_key, FINDINGS_SYSTEM_PROMPT, user_prompt, max_tokens=700)
    return {"draft": draft.strip(), "source_message_ids": [m["id"] for m in messages]}
