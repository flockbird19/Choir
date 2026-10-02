"""
Feature D stage 2: what a connected coding agent can read and do, on behalf of one person in one
project (its grant). agent_mcp.py exposes these as MCP tools; every function re-checks the rules
here with the service client, like verify_thread_access does for the app's own routes.

Agents read shared context only (Team Space, Decisions, the task list, project memory) plus the
private thread made for a task their person claimed. They post only in that thread, never in
Team Space, and can't mark anything done: only the person does (spec §4).
"""

import re
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from backend import llm, memory
from backend import tasks as task_list

MESSAGE_CHARS = 2000
RESULT_CHARS = 1000
CALLS_PER_MINUTE = 30
MESSAGES_PER_HOUR = 60
RECENT_MESSAGES = 30
UTC = timezone.utc


class AgentError(Exception):
    """A refusal the agent should read and act on (shown to it as the tool's error)."""


class Grant:
    def __init__(self, row: dict[str, Any], team_id: str):
        self.id: str = row["id"]
        self.user_id: str = row["user_id"]
        self.project_id: str = row["project_id"]
        self.client_name: str = row.get("client_name") or "Coding agent"
        self.team_id = team_id


def _db():
    return llm.get_db()


def _rows(query) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], query.execute().data)


def find_grant(user_id: str, client_id: str) -> Grant | None:
    """The person's active connection for this tool, while they're still on the project's team."""
    grants = _rows(
        _db().table("agent_grants").select("*").eq("user_id", user_id).eq("client_id", client_id).is_("revoked_at", "null")
    )
    if not grants:
        return None
    projects = _rows(_db().table("projects").select("team_id").eq("id", grants[0]["project_id"]))
    if not projects:
        return None
    member = _rows(
        _db().table("team_members").select("user_id").eq("team_id", projects[0]["team_id"]).eq("user_id", user_id)
    )
    if not member:
        return None
    _db().table("agent_grants").update({"last_used_at": datetime.now(UTC).isoformat()}).eq("id", grants[0]["id"]).execute()
    return Grant(grants[0], projects[0]["team_id"])


# ponytail: per-process limiter; each server instance counts on its own. Move it to the database if
# one looping agent ever spreads across many instances.
_calls: dict[str, deque[float]] = defaultdict(deque)


def check_rate(grant: Grant) -> None:
    now = time.monotonic()
    window = _calls[grant.id]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= CALLS_PER_MINUTE:
        raise AgentError(f"Too many calls: Choir allows {CALLS_PER_MINUTE} a minute. Wait a moment and try again.")
    window.append(now)


# ── Reading ──────────────────────────────────────────────────────────────────


def _shared_thread(project_id: str) -> dict[str, Any] | None:
    rows = _rows(_db().table("threads").select("*").eq("project_id", project_id).eq("type", "shared"))
    return rows[0] if rows else None


def _names(grant: Grant) -> dict[str, str]:
    return {m["user_id"]: m["name"] for m in llm._fetch_team_roster(grant.team_id)}


def _short(task_id: str) -> str:
    return task_id[:8]


def _task_line(t: dict[str, Any], names: dict[str, str]) -> str:
    who = ""
    if t["status"] != "open":
        who = f" · {names.get(t.get('claimed_by') or '', 'a former member')}"
        if t.get("via_client"):
            who += f" via {t['via_client']}"
    return f"[{_short(t['id'])}] {t['status']}{who}: {t['title']}"


def find_task(grant: Grant, task_id: str) -> dict[str, Any]:
    """A task in the grant's project, by its full id or the 8-character short id the tools show."""
    task_id = (task_id or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f-]{8,36}", task_id):
        raise AgentError("That isn't a task id. Use the id list_tasks shows, like 3f9a2c1d.")
    rows = [t for t in task_list.fetch(grant.project_id) if t["id"].startswith(task_id)]
    if len(rows) != 1:
        raise AgentError("No such task in this project." if not rows else "That short id matches more than one task; use the full id.")
    return rows[0]


def project_brief(grant: Grant) -> str:
    project = llm._fetch_project(grant.project_id) or {}
    names = _names(grant)
    tz = llm.user_tz(None)
    me = names.get(grant.user_id, "your person")
    decisions = llm._team_decisions(grant.project_id)
    rows = task_list.fetch(grant.project_id)
    parts = [
        f"PROJECT: {project.get('name') or 'Untitled'}. You work for {me}, connected as {grant.client_name}.",
        "TEAM: " + ", ".join(sorted(names.values())),
        memory.render(grant.project_id, 3_000),
        "DECISIONS (pinned by the team, newest last):\n" + "\n".join(f"- {(d.get('content') or '').strip()}" for d in decisions)
        if decisions
        else "DECISIONS: none pinned yet.",
        "TASKS (the only record of who is doing what):\n" + ("\n".join(_task_line(t, names) for t in rows) or "(none yet)"),
    ]
    shared = _shared_thread(grant.project_id)
    if shared:
        recent, _ = llm._fetch_page(shared["id"], newest=True, limit=RECENT_MESSAGES)
        parts.append(f"TEAM SPACE (latest {len(recent)} messages):\n" + (llm.transcript(llm._visible(recent), names, tz) or "(empty)"))
    return "\n\n".join(p for p in parts if p)


def list_tasks(grant: Grant, which: str = "all") -> str:
    names = _names(grant)
    rows = task_list.fetch(grant.project_id)
    if which == "open":
        rows = [t for t in rows if t["status"] == "open"]
    elif which == "mine":
        rows = [t for t in rows if t.get("claimed_by") == grant.user_id and t["status"] != "done"]
    return "\n".join(_task_line(t, names) for t in rows) or "No tasks match."


def _review_state(task: dict[str, Any]) -> str:
    if task.get("review_message_id"):
        return "Waiting for your person's review."
    if not task.get("thread_id"):
        return "Not started."
    sent_back = _rows(
        _db().table("messages").select("created_at").eq("thread_id", task["thread_id"]).eq("review_state", "sent_back")
        .order("created_at", desc=True).limit(1)
    )
    return "Sent back with changes: read the task thread for the note." if sent_back else "In progress."


def get_task(grant: Grant, task_id: str) -> str:
    task = find_task(grant, task_id)
    names = _names(grant)
    lines = [_task_line(task, names), f"Full id: {task['id']}"]
    if task.get("details"):
        lines += ["", "Details:", task["details"]]
    if task.get("result"):
        lines += ["", f"Result: {task['result']}"]
    if task.get("claimed_by") == grant.user_id:
        lines += ["", f"Review: {_review_state(task)}"]
    source_ids = (task.get("source_message_ids") or []) + (task.get("source_decision_ids") or [])
    shared = _shared_thread(grant.project_id)
    if source_ids and shared:
        # Sources are Team Space messages; anything else (a private message) is never shown.
        sources = _rows(_db().table("messages").select("*").in_("id", source_ids).eq("thread_id", shared["id"]))
        if sources:
            lines += ["", "Where it came from (Team Space):", llm.transcript(llm._visible(sources), names, llm.user_tz(None))]
    return "\n".join(lines)


def search_team_space(grant: Grant, query: str) -> str:
    query = " ".join((query or "").split())[:100]
    if len(query) < 2:
        raise AgentError("Search for at least 2 characters.")
    shared = _shared_thread(grant.project_id)
    if not shared:
        return "This project has no Team Space yet."
    pattern = "%" + re.sub(r"([%_\\])", r"\\\1", query) + "%"
    rows = _rows(
        _db().table("messages").select("*").eq("thread_id", shared["id"]).ilike("content", pattern)
        .order("created_at", desc=True).limit(20)
    )
    found = llm._visible(rows)
    return llm.transcript(found, _names(grant), llm.user_tz(None)) if found else "Nothing in Team Space matches."


# ── The task's private thread ────────────────────────────────────────────────


def _own_task(grant: Grant, task_id: str) -> dict[str, Any]:
    task = find_task(grant, task_id)
    if task["status"] != "claimed" or task.get("claimed_by") != grant.user_id:
        raise AgentError("You can only work on tasks your person has claimed. Ask them first, or use claim_task.")
    return task


def _task_thread(grant: Grant, task: dict[str, Any]) -> str:
    """The task's thread, if it still belongs to the person, in this project."""
    if task.get("thread_id"):
        rows = _rows(
            _db().table("threads").select("id").eq("id", task["thread_id"]).eq("owner_id", grant.user_id)
            .eq("project_id", grant.project_id).eq("type", "private")
        )
        if rows:
            return rows[0]["id"]
    raise AgentError("Start the task first (start_task), which opens its private thread with your person.")


def read_task_thread(grant: Grant, task_id: str, since: str | None = None) -> str:
    task = _own_task(grant, task_id)
    thread = _task_thread(grant, task)
    query = _db().table("messages").select("*").eq("thread_id", thread).order("created_at", desc=True).limit(50)
    if since:
        query = query.gt("created_at", since)
    rows = list(reversed(_rows(query)))
    if not rows:
        return "No new messages."
    names = _names(grant)
    lines = []
    for m in llm._visible(rows):
        state = f" [review card: {m['review_state'] or 'replaced'}]" if m.get("kind") == "task_review" else ""
        lines.append(f"[{m['created_at']}] {llm.sender_label(m, names)}{state}: {m['content']}")
    return "\n".join(lines) + f"\n\n(Pass since={rows[-1]['created_at']} next time to get only newer messages.)"


def _post(grant: Grant, task: dict[str, Any], thread: str, content: str, **extra: Any) -> str:
    since = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    recent = _rows(
        _db().table("messages").select("id").eq("sender_type", "agent").eq("sender_id", grant.user_id).gte("created_at", since)
    )
    if len(recent) >= MESSAGES_PER_HOUR:
        raise AgentError(f"You've posted {MESSAGES_PER_HOUR} messages this hour. Post again later, and only what matters.")
    row = {
        "thread_id": thread, "sender_type": "agent", "sender_id": grant.user_id, "via_client": grant.client_name,
        "content": content, "task_id": task["id"], **extra,
    }  # fmt: skip
    return cast(list[dict[str, Any]], _db().table("messages").insert(row).execute().data)[0]["id"]


def _text(value: str | None, limit: int, what: str) -> str:
    value = (value or "").strip()
    if not value:
        raise AgentError(f"The {what} is empty.")
    if len(value) > limit:
        raise AgentError(f"Keep the {what} under {limit} characters.")
    return value


# ── Writing ──────────────────────────────────────────────────────────────────


def claim_task(grant: Grant, task_id: str) -> str:
    task = find_task(grant, task_id)
    now = datetime.now(UTC).isoformat()
    # The same single conditional update as claim_task in schema.sql: one claim wins.
    _db().table("tasks").update(
        {"status": "claimed", "claimed_by": grant.user_id, "claimed_at": now, "via_client": grant.client_name, "updated_at": now}
    ).eq("id", task["id"]).eq("status", "open").is_("claimed_by", "null").execute()
    task = find_task(grant, task["id"])
    if task.get("claimed_by") == grant.user_id:
        return f"Claimed for your person: {task['title']}. Next: start_task."
    who = _names(grant).get(task.get("claimed_by") or "", "someone")
    raise AgentError(f"Not claimed: {who} already has it ({task['status']}).")


def start_task(grant: Grant, task_id: str) -> str:
    task = _own_task(grant, task_id)
    try:
        thread = _task_thread(grant, task)
    except AgentError:
        title = f"Task · {task['title']}"[:80]
        thread = cast(list[dict[str, Any]], _db().table("threads").insert({
            "project_id": grant.project_id, "type": "private", "owner_id": grant.user_id, "name": title,
            "ai_auto_reply": False,  # "AI waits": Choir AI doesn't answer the agent
        }).execute().data)[0]["id"]  # fmt: skip
    _db().table("tasks").update(
        {"thread_id": thread, "via_client": grant.client_name, "updated_at": datetime.now(UTC).isoformat()}
    ).eq("id", task["id"]).execute()
    return (
        get_task(grant, task["id"])
        + "\n\nTask thread (you and your person):\n"
        + read_task_thread(grant, task["id"])
    )


def post_update(grant: Grant, task_id: str, message: str) -> str:
    task = _own_task(grant, task_id)
    _post(grant, task, _task_thread(grant, task), _text(message, MESSAGE_CHARS, "message"))
    return "Posted in the task thread. Your person sees it; the team doesn't."


def request_review(grant: Grant, task_id: str, summary: str, suggested_result: str, links: list[str] | None = None) -> str:
    task = _own_task(grant, task_id)
    thread = _task_thread(grant, task)
    summary = _text(summary, MESSAGE_CHARS, "summary")
    result = _text(suggested_result, RESULT_CHARS, "suggested result")
    links = [str(link).strip() for link in (links or []) if re.match(r"^https?://\S{1,500}$", str(link).strip())][:10]
    if task.get("review_message_id"):
        # Calling again replaces the waiting card.
        _db().table("messages").update({"review_state": None}).eq("id", task["review_message_id"]).eq("review_state", "open").execute()
    card = _post(
        grant, task, thread, summary, kind="task_review", review_state="open",
        review={"summary": summary, "suggested_result": result, "links": links},
    )  # fmt: skip
    _db().table("tasks").update({"review_message_id": card, "updated_at": datetime.now(UTC).isoformat()}).eq("id", task["id"]).execute()
    _db().table("notifications").insert({
        "user_id": grant.user_id, "team_id": grant.team_id, "project_id": grant.project_id, "kind": "task_review",
        "payload": {"task_id": task["id"], "title": task["title"], "tool": grant.client_name, "thread_id": thread},
    }).execute()  # fmt: skip
    return "Review requested. Your person will mark it done or send it back; check read_task_thread for their answer."


def release_task(grant: Grant, task_id: str, reason: str) -> str:
    task = _own_task(grant, task_id)
    reason = _text(reason, MESSAGE_CHARS, "reason")
    if task.get("thread_id"):
        try:
            _post(grant, task, _task_thread(grant, task), f"Released this task: {reason}")
        except AgentError:
            pass
    if task.get("review_message_id"):
        _db().table("messages").update({"review_state": None}).eq("id", task["review_message_id"]).eq("review_state", "open").execute()
    _db().table("tasks").update({
        "status": "open", "claimed_by": None, "claimed_at": None, "via_client": None, "review_message_id": None,
        "updated_at": datetime.now(UTC).isoformat(),
    }).eq("id", task["id"]).eq("claimed_by", grant.user_id).eq("status", "claimed").execute()  # fmt: skip
    return "Released: the task is open again for anyone on the team."
