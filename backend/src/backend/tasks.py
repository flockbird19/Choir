"""
Feature D: a project's shared task list, as Choir AI, Catch me up, exports and Suggest tasks see it.
The list itself is written only through the task functions in schema.sql (claim_task and so on).
"""

import json
from datetime import timezone
from typing import Any, cast

from backend import llm, memory, prompts

SUGGEST_SYSTEM_PROMPT = prompts.system(prompts.SUGGEST_TASKS_JOB)
SUGGEST_MESSAGES = 120  # latest Team Space messages the AI reads to suggest tasks
SUGGEST_MAX = 8


def fetch(project_id: str) -> list[dict[str, Any]]:
    """Every task in the project, oldest first."""
    # Through llm's handle, like memory.py, so one patch of llm.get_db fakes every read in tests.
    rows = llm.get_db().table("tasks").select("*").eq("project_id", project_id).order("created_at").execute().data
    return cast(list[dict[str, Any]], rows)


def _who(user_id: str | None, names: dict[str, str]) -> str:
    return names.get(user_id or "", "A former member")


def _lines(rows: list[dict[str, Any]], names: dict[str, str], tz: timezone, done_since: str | None) -> list[str]:
    """Open first, then who has what, then what got done (since `done_since`, when given)."""
    lines = [f"- Open: {t['title']}" for t in rows if t["status"] == "open"]
    lines += [
        f"- {_who(t.get('claimed_by'), names)}: {t['title']} (claimed {llm.when(t.get('claimed_at'), tz)})"
        for t in rows
        if t["status"] == "claimed"
    ]
    for t in rows:
        if t["status"] == "done" and (not done_since or (t.get("done_at") or "") > done_since):
            result = f" Result: {t['result']}" if t.get("result") else ""
            lines.append(f"- Done by {_who(t.get('done_by'), names)} ({llm.when(t.get('done_at'), tz)}): {t['title']}.{result}")
    return lines


def block(
    rows: list[dict[str, Any]], names: dict[str, str], tz: timezone, budget_chars: int, *, done_since: str | None = None
) -> str:
    """The TASKS prompt section. The list is the only record of who is doing what."""
    if not rows:
        return "TASKS: none yet. Nobody has claimed anything in the task list."
    lines = _lines(rows, names, tz, done_since)
    shown: list[str] = []
    used = 0
    for line in lines:
        if shown and used + len(line) > budget_chars:
            break
        shown.append(line)
        used += len(line)
    more = len(lines) - len(shown)
    return (
        "TASKS (the team's task list, read just now; it is the only record of who is doing what and what is "
        "done, and it overrides anything earlier messages, memory or summaries say about ownership):\n"
        + ("\n".join(shown) or "- Nothing open, claimed or newly done.")
        + (f"\n({more} more not shown.)" if more else "")
    )


def markdown(rows: list[dict[str, Any]], names: dict[str, str], tz: timezone) -> str:
    """The task list as a Markdown section for exports."""
    if not rows:
        return ""
    return "## Tasks\n\n" + "\n".join(_lines(rows, names, tz, None)) + "\n"


def _same(a: str, b: str) -> bool:
    return " ".join(a.lower().split()) == " ".join(b.lower().split())


def suggest(thread_id: str, user_id: str) -> dict[str, Any]:
    """
    Draft new tasks from Team Space with the caller's own key (like Catch me up). Nothing is
    saved here: people review the drafts and add the ones they want.
    Returns {"suggestions": [{title, details, source_message_ids, source_decision_ids}], "skipped": n}.
    Raises ValueError (not Team Space), llm.NoApiKeyError, or RuntimeError (provider error).
    """
    thread = llm._fetch_thread(thread_id)
    if not thread or thread.get("type") != "shared":
        raise ValueError("Tasks are suggested from Team Space.")
    resolved = llm._resolve_provider_and_model(thread, user_id)
    if not resolved:
        raise llm.NoApiKeyError("No API key found. Please add one in Settings → API Keys before using Suggest tasks.")
    provider, model, api_key = resolved

    names = llm.team_names_for_thread(thread)
    tz = llm.user_tz(None)
    messages, _ = llm._fetch_page(thread_id, newest=True, limit=SUGGEST_MESSAGES)
    decisions = llm._team_decisions(thread["project_id"])
    current = fetch(thread["project_id"])
    parts = [
        memory.render(thread["project_id"], 3_000),
        "TEAM DECISIONS (pinned):\n" + "\n".join(f"- [msg:{d['id']}] {(d.get('content') or '').strip()}" for d in decisions)
        if decisions
        else "TEAM DECISIONS: none pinned yet.",
        "CURRENT TASKS (do not repeat these):\n" + ("\n".join(f"- {t['title']}" for t in current) or "(none)"),
        "TEAM SPACE (latest messages):\n" + (llm.transcript(messages, names, tz, ids=True) or "(none)"),
    ]
    raw = llm.complete_once(provider, model, api_key, SUGGEST_SYSTEM_PROMPT, "\n\n".join(p for p in parts if p), max_tokens=900)

    start, end = raw.find("["), raw.rfind("]")
    try:
        proposed = json.loads(raw[start : end + 1]) if start != -1 and end > start else []
    except json.JSONDecodeError:
        proposed = []

    decision_ids = {d["id"] for d in decisions}
    message_ids = {m["id"] for m in messages}
    out: list[dict[str, Any]] = []
    skipped = 0
    for item in proposed if isinstance(proposed, list) else []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:200]
        if not title:
            continue
        if any(_same(title, t["title"]) for t in current):
            skipped += 1
            continue
        sources = list(dict.fromkeys(str(s).removeprefix("msg:") for s in item.get("sources") or []))
        out.append({
            "title": title,
            "details": str(item.get("details") or "").strip()[:2000] or None,
            "source_message_ids": [s for s in sources if s in message_ids and s not in decision_ids],
            "source_decision_ids": [s for s in sources if s in decision_ids],
        })
    return {"suggestions": out[:SUGGEST_MAX], "skipped": skipped}
