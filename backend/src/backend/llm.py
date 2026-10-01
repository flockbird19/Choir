"""
LLM orchestration module.

Handles:
- Assembling prompt context (shared thread as system context for private threads)
- Streaming from Anthropic, OpenAI, Google Gemini (OpenAI-compat), and Groq (OpenAI-compat)
- Persisting the final assistant message to Supabase after the stream finishes
- Yielding SSE-formatted strings for FastAPI's StreamingResponse
"""

import json
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Generator, cast

from backend import files, prompts, shared_keys
from backend.db import get_db
from backend.keys import get_api_key
from backend.shared_keys import KeyCandidate

logger = logging.getLogger(__name__)


class NoApiKeyError(Exception):
    """Raised when the user has no BYOK key available for any provider."""

# ---------------------------------------------------------------------------
# Provider configuration
# ---------------------------------------------------------------------------

# Providers that use the OpenAI-compatible API (just need base_url override).
# "anthropic" is handled natively with its own SDK.
OPENAI_COMPAT_PROVIDERS: dict[str, dict[str, str]] = {
    "openai": {
        "base_url": "",  # default OpenAI endpoint
        "default_model": "gpt-4o",
    },
    "google": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "default_model": "gemini-2.5-flash",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
    },
}

ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5"

ALL_PROVIDERS = ["anthropic", "openai", "google", "groq"]


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _fetch_thread(thread_id: str) -> dict[str, Any] | None:
    db = get_db()
    resp = db.table("threads").select("*").eq("id", thread_id).execute()
    data = cast(list[dict[str, Any]], resp.data)
    return data[0] if data else None


def _fetch_project(project_id: str) -> dict[str, Any] | None:
    db = get_db()
    resp = db.table("projects").select("*").eq("id", project_id).execute()
    data = cast(list[dict[str, Any]], resp.data)
    return data[0] if data else None


# How many messages are ever read out of Supabase for one reply. The D3 budget below
# trims what is *sent* to the model, but this is what is *read*: an unbounded query
# pulled a thread's entire history over the network on every single turn, which is the
# opposite of what the budget is for. 200 comfortably covers the 40-message verbatim
# window plus the SUMMARY_REFRESH_THRESHOLD of older messages a refresh folds in.
MESSAGE_FETCH_LIMIT = 200


def _fetch_messages(thread_id: str, limit: int = MESSAGE_FETCH_LIMIT) -> list[dict[str, Any]]:
    """The most recent `limit` messages for a thread, oldest first."""
    db = get_db()
    resp = (
        db.table("messages")
        .select("*")
        .eq("thread_id", thread_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return _visible(list(reversed(cast(list[dict[str, Any]], resp.data))))


def _visible(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Drop withdrawn publications (their text is gone and never reaches an AI prompt) and
    compact checkpoint cards (read separately as the thread's summary, never as a message).
    Attached files become a note line in the text, so every AI reader knows they're there.
    """
    return [files.with_notes(m) for m in messages if _is_live(m)]


def _fetch_message_in_thread(message_id: str, thread_id: str) -> dict[str, Any] | None:
    """One message, but only if it really belongs to `thread_id`."""
    db = get_db()
    resp = (
        db.table("messages")
        .select("*")
        .eq("id", message_id)
        .eq("thread_id", thread_id)
        .execute()
    )
    data = cast(list[dict[str, Any]], resp.data)
    return data[0] if data else None


def _fetch_thread_read(thread_id: str, user_id: str) -> str | None:
    db = get_db()
    resp = (
        db.table("thread_reads")
        .select("last_seen_at")
        .eq("thread_id", thread_id)
        .eq("user_id", user_id)
        .execute()
    )
    data = cast(list[dict[str, Any]], resp.data)
    return data[0]["last_seen_at"] if data else None


def _upsert_thread_read(thread_id: str, user_id: str, seen_at: str) -> None:
    db = get_db()
    db.table("thread_reads").upsert(
        {"thread_id": thread_id, "user_id": user_id, "last_seen_at": seen_at},
        on_conflict="thread_id,user_id",
    ).execute()


def _save_assistant_message(
    thread_id: str, content: str, provider: str, model: str, sources: list[dict[str, str]] | None = None
) -> str | None:
    db = get_db()
    row: dict[str, Any] = {
        "thread_id": thread_id,
        "sender_type": "assistant",
        "content": content,
        "model_provider": provider,
        "model_name": model,
    }
    if sources:
        row["sources"] = sources
    resp = db.table("messages").insert(row).execute()
    data = cast(list[dict[str, Any]], resp.data)
    return data[0]["id"] if data else None


# ---------------------------------------------------------------------------
# Team roster — who is on the team, so the AI knows who said what
#
# E4: names come from `profiles` (one query for the whole roster), not the auth
# admin API. That was one admin call per member with a 5-minute cache, so a
# rename reached the AI up to 5 minutes late; `profiles` is always fresh.
# ---------------------------------------------------------------------------

FORMER_MEMBER = "Former member"


def _fetch_profile_names(user_ids: list[str]) -> dict[str, str | None]:
    """{user_id: display_name} for ids that have a `profiles` row (display_name may be empty)."""
    if not user_ids:
        return {}
    resp = get_db().table("profiles").select("id, display_name").in_("id", user_ids).execute()
    rows = cast(list[dict[str, Any]], resp.data)
    return {row["id"]: row.get("display_name") for row in rows}


def _fetch_team_roster(team_id: str) -> list[dict[str, str]]:
    """Team members in join order: [{user_id, name, role}]."""
    resp = (
        get_db()
        .table("team_members")
        .select("user_id, role, joined_at")
        .eq("team_id", team_id)
        .order("joined_at")
        .execute()
    )
    rows = cast(list[dict[str, Any]], resp.data)
    profiles = _fetch_profile_names([row["user_id"] for row in rows])
    roster = []
    for row in rows:
        user_id = row["user_id"]
        if user_id in profiles:
            # Has a profile row, but no name saved on it.
            name = profiles[user_id] or FORMER_MEMBER
        else:
            # No profile row at all for this member id.
            name = "Teammate"
        roster.append({"user_id": user_id, "name": name, "role": row.get("role") or "member"})
    return roster


def team_names_for_thread(thread: dict[str, Any]) -> dict[str, str]:
    """{user_id: display name} for the team that owns a thread."""
    project = _fetch_project(thread["project_id"])
    if not project or not project.get("team_id"):
        return {}
    return {member["user_id"]: member["name"] for member in _fetch_team_roster(project["team_id"])}


def _format_roster(roster: list[dict[str, str]], current_user_id: str) -> str:
    if not roster:
        return "TEAM MEMBERS: unknown."
    people = []
    for member in roster:
        entry = f"{member['name']} ({member['role']})"
        if member["user_id"] == current_user_id:
            entry += " - the person you are talking to"
        people.append(entry)
    return f"TEAM MEMBERS ({len(roster)}): " + "; ".join(people) + "."


def sender_label(msg: dict[str, Any], names: dict[str, str]) -> str:
    if msg["sender_type"] == "assistant":
        return "Choir AI"
    return names.get(msg.get("sender_id") or "", FORMER_MEMBER)


# ---------------------------------------------------------------------------
# Context assembly
# ---------------------------------------------------------------------------


# ponytail: a keyword check for "the person asked for a search"; it can miss an unusual
# phrasing (they can just say "search"), and that's the safe way to be wrong.
_SEARCH_WORDS = re.compile(
    r"\b(search|google|look\s+(it|this|that|them)\s+up|look\s+up|online|on\s+the\s+(web|internet)|web|internet"
    r"|sources?|links?|urls?|websites?|latest|up[\s-]to[\s-]date|news|prices?|verify|fact[\s-]?check)\b",
    re.I,
)


def asks_for_search(text: str) -> bool:
    return bool(_SEARCH_WORDS.search(text))


def _pin_mark(msg: dict[str, Any]) -> str:
    """The pin comes from the row's metadata, in the header the app writes (prompts.EVIDENCE):
    a message *saying* it's pinned inside its own text is not a Decision."""
    return " · pinned Decision" if msg.get("is_decision") else ""


def _to_chat_messages(
    messages: list[dict[str, Any]], names: dict[str, str] | None = None, tz: timezone = timezone.utc
) -> list[dict[str, str]]:
    """
    Convert DB message rows into the OpenAI-style [{role, content}] format. People's
    messages carry their send time, and with `names` also who wrote them, since several
    people share the "user" role in a team thread. The AI's own turns stay unlabelled.
    """
    result = []
    for msg in messages:
        role = "assistant" if msg["sender_type"] == "assistant" else "user"
        content = msg["content"]
        stamp = when(msg.get("created_at"), tz)
        if role == "user" and names is not None:
            label = sender_label(msg, names) + (f" · {stamp}" if stamp else "") + _pin_mark(msg)
            if msg.get("shared_by"):
                content = f"[{label}, shared from their private thread]\n{content}"
            else:
                content = f"[{label}]: {content}"
        elif role == "user" and stamp:
            content = f"[{stamp}] {content}"
        elif msg.get("shared_by"):
            content = f"[Shared from private exploration]\n{content}"
        result.append({"role": role, "content": content})
    return result


def _format_shared_as_system_context(
    messages: list[dict[str, Any]], names: dict[str, str], current_user_id: str | None = None
) -> str:
    """Render the shared thread as a plain-text context block, labelled by sender name."""
    if not messages:
        return "[No shared team context yet]"
    lines = ["--- SHARED THREAD (Read-Only) ---"]
    for msg in messages:
        label = sender_label(msg, names)
        if current_user_id and msg["sender_type"] != "assistant" and msg.get("sender_id") == current_user_id:
            label += " (you)"
        lines.append(f"{label}: {msg['content']}")
    lines.append("--- END SHARED ---")
    return "\n".join(lines)


def _fork_focus_context(
    thread: dict[str, Any], shared_thread_id: str | None, names: dict[str, str]
) -> str:
    """
    D2 "Discuss privately": a private thread started from a shared message is about that
    message. The message is looked up by id *and* shared thread id, so nothing outside
    this project's shared thread can leak in. Looking it up directly rather than scanning
    the loaded history also means the focus still works when the original message is
    older than MESSAGE_FETCH_LIMIT.
    """
    forked_id = thread.get("forked_from_message_id")
    if not forked_id or not shared_thread_id:
        return ""
    focus = _fetch_message_in_thread(forked_id, shared_thread_id)
    if not focus:
        return ""
    return (
        "\nFOCUS: The user started this private thread to discuss one message from the shared thread, "
        f"written by {sender_label(focus, names)}:\n"
        f"\"\"\"\n{focus['content']}\n\"\"\"\n"
        "It is where this conversation started; the user may move on from it.\n"
    )


# ---------------------------------------------------------------------------
# Component #4 — context budget, compact checkpoints, Decisions and time
#
# Every AI call rebuilds its context from the database; the model remembers nothing.
# A thread is read as: its latest compact checkpoint (a visible card, kind='checkpoint')
# plus every message after the checkpoint's covers_through, newest first until the
# budget runs out. If anything would be left out, the thread is compacted first (a new
# visible checkpoint), so no message silently falls between a summary and the recent
# window. Pinned Decisions are read on their own, so an old one never ages out.
# ---------------------------------------------------------------------------

# ponytail: characters / 4 is a rough token estimate for every provider; swap in a real
# tokenizer per provider if budgets ever get tight.
CHARS_PER_TOKEN = 4
DEFAULT_CONTEXT_TOKENS = 16_000
# Groq's free tier caps tokens per minute, so its requests stay small.
CONTEXT_TOKENS = {"groq": 6_000}
KEEP_WHOLE = 8  # the newest messages are never trimmed
OLD_REPLY_CHARS = 1_500  # older AI replies are cut to this, so one long answer can't push out the thread
FETCH_PAGE = 300  # messages read from the database per page
COMPACT_CHUNK_CHARS = 40_000  # how much raw thread one compaction call reads at a time
MANUAL_COMPACT_KEEP = 4  # a manual compact still leaves the last few messages word for word
DECISION_CHARS = 500  # each pinned Decision's text in the prompt, so every Decision fits
MAX_SOURCES = 12  # web pages kept on one reply (4 searches can return dozens)
COMPACTING = "Compacting older messages so nothing is forgotten"

COMPACT_SYSTEM_PROMPT = prompts.system(prompts.COMPACT_JOB)


def context_chars(provider: str) -> int:
    return CONTEXT_TOKENS.get(provider, DEFAULT_CONTEXT_TOKENS) * CHARS_PER_TOKEN


def user_tz(offset_minutes: int | None) -> timezone:
    """The browser's getTimezoneOffset() is minutes *behind* UTC (India sends -330)."""
    return timezone(timedelta(minutes=-(offset_minutes or 0)))


def when(iso: str | None, tz: timezone) -> str:
    """'Mon 29 Sep 14:02' in the user's time zone; the raw value if it isn't a timestamp."""
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz).strftime("%a %d %b %H:%M")
    except ValueError:
        return iso


def today_line(tz: timezone) -> str:
    now = datetime.now(tz)
    offset = now.strftime("%z")
    return f"Today is {now.strftime('%A %d %B %Y')}, {now.strftime('%H:%M')} in the user's time zone (UTC{offset[:3]}:{offset[3:]})."


def _is_live(msg: dict[str, Any]) -> bool:
    return not msg.get("withdrawn_at") and (msg.get("kind") or "message") == "message"


def _fetch_page(
    thread_id: str, after: str | None = None, until: str | None = None, *, newest: bool, limit: int = FETCH_PAGE
) -> tuple[list[dict[str, Any]], int]:
    """
    One page of a thread's live messages with after < created_at <= until, oldest first.
    `newest` takes the page from the end of that range, otherwise from its start. Also
    returns the raw row count, so callers can tell whether more rows are left.
    """
    query = get_db().table("messages").select("*").eq("thread_id", thread_id)
    if after:
        query = query.gt("created_at", after)
    if until:
        query = query.lte("created_at", until)
    rows = cast(list[dict[str, Any]], query.order("created_at", desc=newest).limit(limit).execute().data)
    if newest:
        rows = list(reversed(rows))
    return _visible(rows), len(rows)


def _latest_checkpoint(thread_id: str, until: str | None = None) -> dict[str, Any] | None:
    """
    The live checkpoint that reaches furthest, counting only what it *covers*: one written
    while answering a question (after it, by the clock) still counts for that question if
    everything it summarises came before it (codex review: the card made to answer a
    question used to be ignored by that very answer).
    """
    query = get_db().table("messages").select("*").eq("thread_id", thread_id).eq("kind", "checkpoint")
    if until:
        query = query.lte("covers_through", until)
    rows = cast(list[dict[str, Any]], query.order("covers_through", desc=True).limit(10).execute().data)
    return next((m for m in rows if not m.get("withdrawn_at")), None)


def _latest_message(thread_id: str) -> dict[str, Any] | None:
    rows, _ = _fetch_page(thread_id, newest=True, limit=5)
    return rows[-1] if rows else None


def _fit(
    messages: list[dict[str, Any]], budget_chars: int, *, trim: bool = True
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    (kept, dropped): newest first until the budget runs out, oldest first in the result.
    The newest KEEP_WHOLE messages stay whole; with `trim`, older AI replies are shortened.
    The newest message is always kept, cut down to the budget if it alone is bigger.
    """
    kept: list[dict[str, Any]] = []
    used = 0
    for index, msg in enumerate(reversed(messages)):
        content = msg.get("content") or ""
        if trim and index >= KEEP_WHOLE and msg["sender_type"] == "assistant" and len(content) > OLD_REPLY_CHARS:
            content = content[:OLD_REPLY_CHARS] + "\n[...trimmed; the full reply is in the thread]"
        if not kept and len(content) > budget_chars:
            content = content[: max(budget_chars, 200)] + "\n[...cut to fit]"
        size = len(content) + 60  # sender, time and formatting
        if kept and used + size > budget_chars:
            break
        kept.append({**msg, "content": content} if content != msg.get("content") else msg)
        used += size
    kept.reverse()
    return kept, messages[: len(messages) - len(kept)]


def thread_view(thread_id: str, until: str | None, budget_chars: int) -> dict[str, Any]:
    """
    What the AI reads of one thread: the latest checkpoint, the messages after it that fit,
    and whether anything had to be left out (`overflow`), which means it's time to compact.
    """
    # The real messages beat any summary of them: when the whole thread fits, read it all and
    # leave the compact card aside. A card is only a stand-in for what no longer fits.
    everything, raw_all = _fetch_page(thread_id, None, until, newest=True)
    if raw_all < FETCH_PAGE:
        kept, dropped = _fit(everything, budget_chars, trim=False)
        if not dropped and kept == everything:
            return {"checkpoint": None, "messages": kept, "overflow": False, "all": everything}

    checkpoint = _latest_checkpoint(thread_id, until)
    after = checkpoint["covers_through"] if checkpoint else None
    messages, raw = _fetch_page(thread_id, after, until, newest=True)
    room = budget_chars - len(checkpoint["content"]) if checkpoint else budget_chars
    kept, dropped = _fit(messages, max(room, budget_chars // 4))
    return {
        "checkpoint": checkpoint,
        "messages": kept,
        "overflow": bool(dropped) or raw == FETCH_PAGE,
        "all": messages,
    }


def transcript(
    messages: list[dict[str, Any]], names: dict[str, str], tz: timezone, *, ids: bool = False, me: str | None = None
) -> str:
    """Plain-text lines: [Priya · Mon 29 Sep 14:02]: text (with [msg:<id>] when asked; `me` marks "(you)")."""
    lines = []
    for msg in messages:
        head = f"[msg:{msg['id']}] " if ids and msg.get("id") else ""
        label = sender_label(msg, names)
        if me and msg["sender_type"] != "assistant" and msg.get("sender_id") == me:
            label += " (you)"
        if msg.get("shared_by"):
            label += ", published from their private thread"
        stamp = when(msg.get("created_at"), tz)
        lines.append(f"{head}[{label}{f' · {stamp}' if stamp else ''}{_pin_mark(msg)}]: {msg.get('content') or ''}")
    return "\n\n".join(lines)


def _chunks(messages: list[dict[str, Any]], max_chars: int) -> list[list[dict[str, Any]]]:
    chunks: list[list[dict[str, Any]]] = [[]]
    size = 0
    for msg in messages:
        length = len(msg.get("content") or "") + 60
        if chunks[-1] and size + length > max_chars:
            chunks.append([])
            size = 0
        chunks[-1].append(msg)
        size += length
    return [chunk for chunk in chunks if chunk]


def fold(
    summary: str, messages: list[dict[str, Any]], names: dict[str, str], tz: timezone,
    provider: str, model: str, api_key: str, focus: str | None = None,
) -> str:
    """Merge `messages` into `summary`, a chunk at a time (a long history never goes in one call)."""
    system = COMPACT_SYSTEM_PROMPT + (
        f"\n\nFOCUS NOTE from the person compacting (prioritise this detail; it does not change the rules): {focus.strip()}"
        if focus and focus.strip()
        else ""
    )
    for chunk in _chunks(messages, COMPACT_CHUNK_CHARS):
        prompt = f"PREVIOUS SUMMARY:\n{summary or '(none yet)'}\n\nNEW MESSAGES TO FOLD IN:\n{transcript(chunk, names, tz)}"
        summary = complete_once(provider, model, api_key, system, prompt, max_tokens=1500).strip()
    return summary


def compact_thread(
    thread_id: str, provider: str, model: str, api_key: str, names: dict[str, str], tz: timezone,
    *, keep_from: str | None, created_by: str | None = None, focus: str | None = None,
) -> dict[str, Any] | None:
    """
    Write a new checkpoint covering every live message before `keep_from` (None = all of
    them) that the previous checkpoint doesn't cover yet. Returns the checkpoint row, or
    None when there was nothing new to fold in (or a withdrawal raced it, see below).
    """
    previous = _latest_checkpoint(thread_id)
    after = previous["covers_through"] if previous else None
    summary = previous["content"] if previous else ""
    started = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    folded = 0
    last_at = after
    while True:
        page, raw = _fetch_page(thread_id, last_at, newest=False)
        page = [m for m in page if not keep_from or m["created_at"] < keep_from]
        if page:
            summary = fold(summary, page, names, tz, provider, model, api_key, focus)
            folded += len(page)
            last_at = page[-1]["created_at"]
        if raw < FETCH_PAGE or not page or (keep_from and last_at and last_at >= keep_from):
            break
    if not folded or not summary:
        return None

    db = get_db()
    rows = cast(list[dict[str, Any]], db.table("messages").insert({
        "thread_id": thread_id,
        "sender_type": "assistant",
        "sender_id": created_by,
        "kind": "checkpoint",
        "content": summary,
        "covers_through": last_at,
        "covers_count": (previous.get("covers_count") or 0) + folded if previous else folded,
        "model_provider": provider,
        "model_name": model,
    }).execute().data)
    checkpoint = rows[0] if rows else None

    # withdraw_publication() undoes checkpoints that cover a withdrawn post, in the same
    # transaction as the withdrawal. One written while that ran may still contain it, so
    # check after our write: either it ran after us (and undid us), or we see it here.
    withdrawn = db.table("messages").select("id").eq("thread_id", thread_id).gte("withdrawn_at", started).limit(1).execute()
    if checkpoint and withdrawn.data:
        db.table("messages").update({"withdrawn_at": datetime.now(timezone.utc).isoformat()}).eq("id", checkpoint["id"]).execute()
        return None
    return checkpoint


def compact_until_it_fits(
    thread_id: str, until: str | None, budget_chars: int, provider: str, model: str, api_key: str,
    names: dict[str, str], tz: timezone,
) -> dict[str, Any]:
    """Auto-compact: fold the older part so the rest fits in half the budget, then re-read."""
    view = thread_view(thread_id, until, budget_chars)
    if not view["overflow"]:
        return view
    tail, _ = _fit(view["all"], budget_chars // 2)
    compact_thread(thread_id, provider, model, api_key, names, tz, keep_from=tail[0]["created_at"] if tail else None)
    return thread_view(thread_id, until, budget_chars)


def compact_room(thread_id: str, provider: str) -> dict[str, Any]:
    """How much of the AI's reading room this thread fills, and whether Compact would help."""
    budget = context_chars(provider) * 3 // 4
    view = thread_view(thread_id, None, budget)
    used = sum(len(m.get("content") or "") + 60 for m in view["messages"])
    return {"can_compact": view["overflow"], "percent": 100 if view["overflow"] else min(99, used * 100 // budget)}


def compact_now(thread: dict[str, Any], user_id: str, focus: str | None, tz_offset: int | None) -> dict[str, Any]:
    """The Compact action: fold everything except the last few messages. Raises ValueError/NoApiKeyError."""
    resolved = resolve_key(thread, user_id)
    if not resolved:
        raise NoApiKeyError("No API key found. Please add one in Settings → API Keys before compacting.")
    provider, model, api_key = resolved
    # While the whole thread fits, Choir AI reads every message and would ignore a card, so a
    # compact would only lose detail (it once summarised away an option the AI then denied).
    if not compact_room(thread["id"], provider)["can_compact"]:
        raise ValueError(
            "Nothing worth compacting yet: Choir AI can still read this whole thread word for word."
        )
    tail, _ = _fetch_page(thread["id"], newest=True, limit=MANUAL_COMPACT_KEEP + 1)
    if len(tail) <= MANUAL_COMPACT_KEEP:
        raise ValueError("There's nothing new to compact yet.")
    keep_from = tail[-MANUAL_COMPACT_KEEP]["created_at"]
    checkpoint = compact_thread(
        thread["id"], provider, model, api_key, team_names_for_thread(thread), user_tz(tz_offset),
        keep_from=keep_from, created_by=user_id, focus=focus,
    )
    if not checkpoint:
        raise ValueError("There's nothing new to compact yet.")
    return checkpoint


def _team_decisions(project_id: str) -> list[dict[str, Any]]:
    """Every pinned Decision in the project's Team Space, oldest first, read on its own."""
    db = get_db()
    shared = cast(list[dict[str, Any]], db.table("threads").select("id").eq("project_id", project_id).eq("type", "shared").execute().data)
    if not shared:
        return []
    rows = cast(list[dict[str, Any]], (
        db.table("messages").select("*").eq("thread_id", shared[0]["id"]).eq("is_decision", True).order("pinned_at").execute()
    ).data)
    return _visible(rows)


def decisions_block(decisions: list[dict[str, Any]], names: dict[str, str], tz: timezone, budget_chars: int) -> str:
    """Newest Decisions first until the budget runs out; says how many didn't fit."""
    if not decisions:
        # Said outright: with no section at all, the AI read "sounds good" as a decision.
        return (
            "TEAM DECISIONS: none pinned yet. Nothing in this project is a formal Decision until "
            "someone pins it; agreement in chat, however clear, is not a pin."
        )
    lines: list[str] = []
    used = 0
    for msg in reversed(decisions):
        text = (msg.get("content") or "").strip()
        # One long pin (a pasted file) must not push every other Decision out of view.
        if len(text) > DECISION_CHARS:
            text = text[:DECISION_CHARS] + " [...cut; the full Decision is pinned in Team Space]"
        line = f"- [{sender_label(msg, names)} · pinned {when(msg.get('pinned_at') or msg.get('created_at'), tz)}] {text}"
        if lines and used + len(line) > budget_chars:
            break
        lines.append(line)
        used += len(line)
    lines.reverse()
    missing = len(decisions) - len(lines)
    note = f"\n({missing} older Decisions not shown.)" if missing else ""
    return (
        "TEAM DECISIONS (pinned in Team Space, read just now: the team's current commitments; quote them "
        "exactly when asked. This list is the only record of what is pinned: it overrides anything your "
        "earlier replies, project memory or summaries said about Decisions):\n"
        + "\n".join(lines) + note
    )


def tasks_text(project_id: str, names: dict[str, str], tz: timezone, budget_chars: int, *, done_since: str | None = None) -> str:
    """Feature D: the TASKS block, read fresh (imported here lazily: tasks imports this module)."""
    from backend import tasks

    return tasks.block(tasks.fetch(project_id), names, tz, budget_chars, done_since=done_since)


def checkpoint_block(checkpoint: dict[str, Any] | None, label: str, tz: timezone) -> str:
    if not checkpoint:
        return ""
    return (
        f"{label} (a compact summary Choir wrote of {checkpoint.get('covers_count') or 'the'} earlier messages, "
        f"up to {when(checkpoint.get('covers_through'), tz)}; it can miss details, and the thread is the record):\n"
        f"{checkpoint['content']}"
    )


def resolve_key(thread: dict[str, Any], user_id: str) -> tuple[str, str, str] | None:
    """Same first choice as @AI: Team Space uses the team's keys first, private threads the caller's."""
    if thread["type"] == "shared":
        project = _fetch_project(thread["project_id"])
        first_keys, _ = shared_keys.plan_keys(get_db(), project, ALL_PROVIDERS)
        choice = _take_usable_key(first_keys)
        if choice:
            candidate, api_key = choice
            return candidate.provider, candidate.model or _default_model(candidate.provider), api_key
    return _resolve_provider_and_model(thread, user_id)


def _default_model(provider: str) -> str:
    return ANTHROPIC_DEFAULT_MODEL if provider == "anthropic" else OPENAI_COMPAT_PROVIDERS[provider]["default_model"]


def _take_usable_key(candidates: list[KeyCandidate]) -> tuple[KeyCandidate, str] | None:
    """Pop candidates until one has a saved key. Only that one key is decrypted."""
    while candidates:
        candidate = candidates.pop(0)
        api_key = get_api_key(candidate.user_id, candidate.provider)
        if api_key:
            if candidate.shared_key_id:
                shared_keys.mark_used(get_db(), candidate.shared_key_id)
            return candidate, api_key
    return None


def _resolve_provider_and_model(
    thread: dict[str, Any], user_id: str, override_provider: str | None = None, override_model: str | None = None
) -> tuple[str, str, str] | None:
    """
    Determine which provider + model to use for this thread, and hand back the
    decrypted key that proved the choice was usable.
    If overrides are provided, uses them (fails if no key).
    For private threads: use thread.model_provider / thread.model_name if set,
    otherwise fall back to the first provider for which the user has a key.
    Returns (provider, model, api_key) or None if no key is available.

    The key is returned rather than looked up again by the caller: every caller
    needs it immediately, and re-fetching cost a second round trip to Supabase
    (300-500ms) plus a second decryption on every reply, digest and findings draft.
    """
    if override_provider and override_model:
        key = get_api_key(user_id, override_provider)
        if key:
            return override_provider, override_model, key
        return None

    thread_provider = thread.get("model_provider")
    thread_model = thread.get("model_name")

    candidates: list[str] = []
    if thread_provider:
        candidates.append(thread_provider)
    # Append all others as fallbacks
    for p in ALL_PROVIDERS:
        if p not in candidates:
            candidates.append(p)

    for provider in candidates:
        key = get_api_key(user_id, provider)
        if key:
            model = thread_model if (thread_provider == provider and thread_model) else _default_model(provider)
            return provider, model, key

    return None


# ---------------------------------------------------------------------------
# One-shot completion — shared by streaming's summary refresh, Catch Me Up and
# Publish findings (FU-3: used to be duplicated ~25 lines apiece).
# ---------------------------------------------------------------------------


def complete_once(
    provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str | list[dict[str, Any]], max_tokens: int
) -> str:
    """
    Single non-streaming completion. `user_prompt` is text, or blocks with files (with_files).
    Raises RuntimeError with a friendly message on a rate limit or other upstream provider error.
    """
    try:
        if provider == "anthropic":
            import anthropic  # type: ignore

            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            return response.content[0].text if response.content else ""  # type: ignore[union-attr]

        import openai as openai_module  # type: ignore

        base_url: str | None = OPENAI_COMPAT_PROVIDERS[provider]["base_url"] or None
        client = openai_module.OpenAI(api_key=api_key, base_url=base_url)
        response = client.chat.completions.create(  # type: ignore[call-overload]
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": openai_content(user_prompt, provider)},
            ],
        )
        return response.choices[0].message.content or ""

    except Exception as exc:
        err = str(exc)
        if "429" in err or "rate_limit" in err.lower() or "quota" in err.lower():
            raise RuntimeError(
                "Rate limit reached. Please check your API key usage limits or try again later."
            ) from exc
        raise RuntimeError(f"AI error: {err}") from exc


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


def openai_content(content: str | list[dict[str, Any]], provider: str) -> str | list[dict[str, Any]]:
    """Anthropic-shaped blocks as OpenAI chat parts: images as data URLs (if the provider sees
    images), the rest as text. Plain text when no image is left, which every model takes."""
    if isinstance(content, str):
        return content
    parts: list[dict[str, Any]] = []
    for block in content:
        if block["type"] == "image" and files.sees_images(provider):
            source = block["source"]
            parts.append({"type": "image_url", "image_url": {"url": f"data:{source['media_type']};base64,{source['data']}"}})
        elif block["type"] == "text":
            parts.append({"type": "text", "text": block["text"]})
        # A PDF opened for Anthropic reaches another provider only after a rate-limit switch
        # mid-answer; its note line in the message still says it's there.
    if any(p["type"] == "image_url" for p in parts):
        return parts
    return "\n\n".join(p["text"] for p in parts)


def content_chars(content: str | list[dict[str, Any]]) -> int:
    return len(content) if isinstance(content, str) else sum(len(b.get("text", "")) for b in content)


def with_files(
    head: str, messages: list[dict[str, Any]], render: Any, provider: str, sep: str = "\n\n"
) -> str | list[dict[str, Any]]:
    """
    A one-shot prompt (Catch me up, Publish findings, Export as prompt): `head`, then each
    message as `render(message)` with its opened files right after it, as in the chat. Plain text
    when no file is opened.
    """
    order = list(reversed(messages))
    opened = files.read_for_ai(order, provider) if any(files.attachments_of(m) for m in order) else {}
    parts: list[dict[str, Any]] = []
    text = head
    for msg in messages:
        text += render(msg) + sep
        if msg.get("id") in opened:
            parts += [{"type": "text", "text": text}, *opened[msg["id"]]]
            text = ""
    if not parts:
        return text.rstrip()
    if text.strip():
        parts.append({"type": "text", "text": text.rstrip()})
    return parts


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _stream_text(
    provider: str,
    model: str,
    api_key: str,
    system_stable: str,
    system_volatile: str,
    chat_messages: list[dict[str, Any]],
    search: bool = False,
) -> Generator[str | dict[str, Any], None, None]:
    """
    Yield text chunks from one provider call. `system_stable` is the part of the
    system prompt that stays the same across turns in this thread (team roster,
    role/style instructions); `system_volatile` is what changes every turn (the time, who's
    asking, the Decisions). It goes at the end of the last turn, after the conversation, so
    everything before it (files included) is the same next turn and can be cached.
    A message's content is text or a list of Anthropic-shaped blocks (its files).
    """
    chat_messages = list(chat_messages)
    if chat_messages and chat_messages[-1]["role"] == "user":
        content = chat_messages[-1]["content"]
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else list(content)
        if provider == "anthropic":
            # Cache the conversation up to here; Anthropic finds it again next turn.
            blocks[-1] = {**blocks[-1], "cache_control": {"type": "ephemeral"}}
        if system_volatile:
            blocks.append({"type": "text", "text": system_volatile})
        chat_messages[-1] = {"role": "user", "content": blocks}
        system_volatile = ""

    if provider == "anthropic":
        import anthropic  # type: ignore

        client = anthropic.Anthropic(api_key=api_key)
        # D3: mark the stable part cacheable so repeated turns in the same
        # thread reuse it instead of re-processing it every time.
        system_blocks: list[dict[str, Any]] = []
        if system_stable:
            system_blocks.append(
                {"type": "text", "text": system_stable, "cache_control": {"type": "ephemeral"}}
            )
        if system_volatile:
            system_blocks.append({"type": "text", "text": system_volatile})
        # Native server-side tool, no extra credentials or dependency: Anthropic runs the
        # search itself and streams grounded text back. max_uses caps searches per reply
        # so one message can't run away with an unbounded number of paid searches.
        # Attached only when the person's message asks for a search (asks_for_search): a rule in
        # the prompt alone didn't stop the model searching on its own.
        extra: dict[str, Any] = (
            {"tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}]} if search else {}
        )
        with client.messages.stream(
            model=model,
            max_tokens=4096,
            system=system_blocks,
            messages=chat_messages,  # type: ignore[arg-type]
            **extra,  # type: ignore[arg-type]
        ) as stream:
            # Text comes out as str; what the model is doing (searching, reading results)
            # comes out as dicts, which stream_ai_response turns into activity frames.
            queries: dict[int, str] = {}
            for event in stream:
                if event.type == "content_block_start":
                    block = event.content_block
                    if block.type == "server_tool_use":
                        queries[event.index] = ""
                    elif block.type == "web_search_tool_result":
                        results = block.content if isinstance(block.content, list) else []
                        found = [{"url": r.url, "title": r.title or r.url} for r in results if getattr(r, "url", None)]
                        yield {"sources": found}
                        yield {"activity": f"Reading {len(found)} result{'s' if len(found) != 1 else ''}" if found else "The search found nothing"}
                elif event.type == "content_block_delta":
                    if event.delta.type == "text_delta":
                        yield event.delta.text
                    elif event.delta.type == "input_json_delta" and event.index in queries:
                        queries[event.index] += event.delta.partial_json
                elif event.type == "content_block_stop" and event.index in queries:
                    try:
                        query = json.loads(queries.pop(event.index) or "{}").get("query")
                    except ValueError:
                        query = None
                    yield {"activity": f"Searching the web for “{query}”" if query else "Searching the web"}
        return

    import openai as openai_module  # type: ignore

    config = OPENAI_COMPAT_PROVIDERS[provider]
    base_url: str | None = config["base_url"] or None
    client = openai_module.OpenAI(api_key=api_key, base_url=base_url)
    system_prompt = "\n".join(part for part in (system_stable, system_volatile) if part)
    all_messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *({"role": m["role"], "content": openai_content(m["content"], provider)} for m in chat_messages),
    ]
    with client.chat.completions.create(  # type: ignore[call-overload]
        model=model,
        messages=all_messages,  # type: ignore[arg-type]
        stream=True,
    ) as stream:
        for chunk in stream:
            delta = chunk.choices[0].delta.content  # type: ignore[union-attr]
            if delta:
                yield delta


# ---------------------------------------------------------------------------
# Main streaming function
# ---------------------------------------------------------------------------


def stream_ai_response(
    thread_id: str,
    user_id: str,
    override_provider: str | None = None,
    override_model: str | None = None,
    user_name: str | None = None,
    thread: dict[str, Any] | None = None,
    message_id: str | None = None,
    tz_offset: int | None = None,
) -> Generator[str, None, None]:
    """
    Core generator: assembles context, calls the LLM, streams SSE chunks to the
    caller, and persists the completed message to Supabase when done.

    `message_id` is the message that asked (component #4): the answer is built from the
    thread as it stood at that message, so a teammate's message sent a moment later can't
    be answered in its place. Without it, the thread's latest message is the one.

    SSE event shapes:
      { "text": "..." }        — incremental token
      { "notice": "...", "model": "..." } — switched to a lent key after a rate limit
      { "activity": "..." }    — what the AI is doing now (reading, compacting, thinking, searching, writing)
      { "sources": [{url, title}] } — every web page found so far (Anthropic search only), saved on the reply
      { "error": "..." }       — terminal error
      { "done": true, "message_id": ..., "model_provider": ..., "model_name": ... } — stream finished
    """
    # ── Fetch thread ──────────────────────────────────────────────────────────
    # The caller's access check has already read this row; reuse it rather than
    # spending another round trip on the same query.
    thread = thread or _fetch_thread(thread_id)
    if not thread:
        yield _sse({"error": "Thread not found."})
        return

    # ── The message being answered ────────────────────────────────────────────
    trigger = _fetch_message_in_thread(message_id, thread_id) if message_id else _latest_message(thread_id)
    if message_id and not trigger:
        yield _sse({"error": "That message no longer exists."})
        return
    if message_id and trigger and trigger["sender_type"] == "user" and trigger.get("sender_id") != user_id:
        yield _sse({"error": "You can only ask the AI about your own message."})
        return
    until = trigger["created_at"] if trigger else None
    tz = user_tz(tz_offset)

    project = _fetch_project(thread["project_id"])

    # ── Resolve provider / model ──────────────────────────────────────────────
    # The shared thread runs on pooled keys, then the project owner's key and model,
    # so teammates without keys of their own can still use @AI. Keys left in
    # `spare_keys` (other first choices, then fallback keys) are tried if the one in
    # use hits a rate limit. Private threads (and shared threads with no usable team
    # key) use the caller's own keys and never a lent one.
    is_shared = thread["type"] == "shared"
    first_keys, fallback_keys = (
        shared_keys.plan_keys(get_db(), project, ALL_PROVIDERS) if is_shared else ([], [])
    )
    team_choice = _take_usable_key(first_keys)
    spare_keys: list[KeyCandidate] = first_keys + fallback_keys if team_choice else []
    key_owner_id: str | None = None
    if team_choice:
        candidate, api_key = team_choice
        provider = candidate.provider
        model = candidate.model or _default_model(provider)
        key_owner_id = candidate.user_id
    else:
        resolved = _resolve_provider_and_model(thread, user_id, override_provider, override_model)
        if not resolved:
            yield _sse(
                {
                    "error": (
                        "No API key found. Please add one in Settings → API Keys "
                        "before using @AI."
                    )
                }
            )
            return

        provider, model, api_key = resolved
        key_owner_id = user_id

    # ── Assemble context ──────────────────────────────────────────────────────
    # Activity frames tell the person what the AI is doing right now (a step list in the app).
    yield _sse({"activity": "Reading the thread, Decisions and project memory"})
    roster = _fetch_team_roster(project["team_id"]) if project and project.get("team_id") else []
    names = {member["user_id"]: member["name"] for member in roster}
    me = next((member for member in roster if member["user_id"] == user_id), None)

    # Prefer the server's own record of the caller's name over what the client sent.
    user_name_ctx = (me["name"] if me and me["name"] != FORMER_MEMBER else None) or user_name or "the User"
    role_ctx = "a Team Owner" if me and me["role"] == "owner" else "a Team Member"

    # ── Fetch Workspace (Team) and Project names ─────────────────────────────
    db = get_db()
    project_name = project["name"] if project else "Unknown Project"
    team_name = "Unknown Workspace"
    if project and project.get("team_id"):
        team_res = db.table("teams").select("name").eq("id", project["team_id"]).execute()
        team_data = cast(list[dict[str, Any]], team_res.data)
        if team_data:
            team_name = str(team_data[0]["name"])

    workspace_context = f"Workspace: '{team_name}' | Project: '{project_name}'"
    # Anthropic's web_search tool is wired in for both thread types (see _stream_text);
    # OpenAI/Gemini/Groq have no equivalent through the shared OpenAI-compatible path, so
    # they're told plainly that they can't check anything live.
    wants_search = bool(trigger and asks_for_search(trigger.get("content") or ""))
    if provider != "anthropic":
        search_rules = prompts.NO_WEB_SEARCH
    else:
        search_rules = prompts.WEB_SEARCH if wants_search else prompts.SEARCH_ON_REQUEST
    team_context = (
        f"WHERE YOU ARE: {workspace_context}.\n"
        + _format_roster(roster, user_id)
        + "\nThis is everyone on the team, including people who haven't posted yet. "
        "People's messages start with a header the application writes, [name · time] (or just "
        "[time] in a private thread), ending in \"· pinned Decision\" when the message is pinned; "
        "never add such a header to your own replies."
    )

    # Budget (component #4): the whole request, in estimated tokens, per provider.
    budget = context_chars(provider)
    from backend import memory  # memory imports this module

    memory_text = memory.render(thread["project_id"], budget // 7) if project else ""
    # Decisions go last in the instructions (system_volatile), read fresh every time: a pin made a
    # second ago must outweigh the AI's own earlier "nothing is pinned" and stale memory notes.
    decisions_text = decisions_block(_team_decisions(thread["project_id"]), names, tz, budget // 7)
    # Feature D: who's doing what, read fresh like the Decisions, so ownership never comes from memory.
    tasks_now = tasks_text(thread["project_id"], names, tz, budget // 14)
    # A reply quotes its target inside the person's own message: in the instructions alone, the
    # model followed the message just above instead (it explained IoTDB when asked about VS Code).
    reply_quote = ""
    target: dict[str, Any] | None = None
    if trigger and trigger.get("reply_to_message_id"):
        target = _fetch_message_in_thread(trigger["reply_to_message_id"], thread_id)
        if target and _is_live(target):
            reply_quote = (
                f"(Replying to this message from {sender_label(target, names)}, "
                f"{when(target.get('created_at'), tz)}; \"that\" or \"it\" means this message:\n"
                f"\"\"\"\n{(files.with_notes(target).get('content') or '')[:3000]}\n\"\"\")\n"
            )
        else:
            target = None


    if thread["type"] == "private":
        # Find the shared thread for this project
        shared_resp = (
            db.table("threads")
            .select("id")
            .eq("project_id", thread["project_id"])
            .eq("type", "shared")
            .execute()
        )
        shared_rows = cast(list[dict[str, Any]], shared_resp.data)
        shared_thread_id = shared_rows[0]["id"] if shared_rows else None

        # Fetched by id, so the focus survives even when it predates the read limit.
        fork_context = _fork_focus_context(thread, shared_thread_id, names)

        system_stable = (
            prompts.system(prompts.PRIVATE_JOB)
            + "\n\n" + search_rules
            + "\n\n" + team_context + "\n"
            + fork_context
        )
        if memory_text:
            system_stable += "\n" + memory_text + "\n"

        # Team Space gets a quarter of what's left; this thread gets the rest. Team Space isn't
        # compacted from here (that would post a card there on a private thread's behalf); its
        # durable content reaches this thread through project memory and Decisions.
        room = max(budget - len(system_stable) - len(reply_quote) - len(decisions_text), budget // 3)
        team_space_block = "[No shared team context yet]"
        if shared_thread_id:
            shared_view = thread_view(shared_thread_id, None, room // 4)
            team_space_block = (
                "--- TEAM SPACE (read-only; the latest messages that fit) ---\n"
                + transcript(shared_view["messages"], names, tz, me=user_id)
                + "\n--- END TEAM SPACE ---"
            )
            if shared_view["overflow"]:
                team_space_block = (
                    "(Older Team Space messages aren't shown here; project memory and Decisions carry "
                    "what the team settled.)\n" + team_space_block
                )
            summary = checkpoint_block(shared_view["checkpoint"], "EARLIER IN TEAM SPACE", tz)
            if summary:
                team_space_block = summary + "\n\n" + team_space_block

        own_room = room - room // 4
        view = thread_view(thread_id, until, own_room)
        if view["overflow"]:
            yield _sse({"activity": COMPACTING})
            view = compact_until_it_fits(thread_id, until, own_room, provider, model, api_key, names, tz)

        own_summary = checkpoint_block(view["checkpoint"], "EARLIER IN THIS PRIVATE THREAD", tz)
        if own_summary:
            system_stable += "\n" + own_summary + "\n"
        system_stable += "\n" + team_space_block + "\n"
        # Only the owner writes in a private thread, so no sender labels are needed.
        chat_messages = _to_chat_messages(view["messages"], None, tz)

    else:
        system_stable = (
            prompts.system(prompts.TEAM_SPACE_JOB)
            + "\n\n" + search_rules
            + "\n\n" + team_context + "\n"
        )
        if memory_text:
            system_stable += "\n" + memory_text + "\n"
        room = max(budget - len(system_stable) - len(reply_quote) - len(decisions_text), budget // 3)
        view = thread_view(thread_id, until, room)
        if view["overflow"]:
            yield _sse({"activity": COMPACTING})
            view = compact_until_it_fits(thread_id, until, room, provider, model, api_key, names, tz)
        summary = checkpoint_block(view["checkpoint"], "EARLIER IN TEAM SPACE", tz)
        if summary:
            system_stable += "\n" + summary + "\n"
        chat_messages = _to_chat_messages(view["messages"], names, tz)

    if reply_quote and chat_messages and chat_messages[-1]["role"] == "user":
        chat_messages[-1] = {"role": "user", "content": reply_quote + chat_messages[-1]["content"]}

    # Files stay inside the message they were sent with, like ChatGPT and Claude.ai: the AI sees
    # which file came when and from whom, so nothing has to guess which file a question means
    # (three guessing rules each broke a live case). The asked and replied-to messages' files are
    # opened first, then newest to oldest until the caps; the rest stay as note lines.
    in_view = {m.get("id"): i for i, m in enumerate(view["messages"])}
    order = [m for m in (trigger, target) if m] + list(reversed(view["messages"]))
    if any(files.attachments_of(m) for m in order):
        yield _sse({"activity": "Opening the attached files"})
    # ponytail: file text sits outside the thread budget (half of it at most); fine for
    # Choir's providers, measure before adding files to a smaller one.
    opened = files.read_for_ai(order, provider, min(files.TEXT_TOTAL, budget // 2))
    for mid, blocks in opened.items():
        # A replied-to message too old for the window brings its files along with its quote.
        index = in_view.get(mid, len(chat_messages) - 1 if target and mid == target["id"] else None)
        if index is not None and chat_messages and chat_messages[index]["role"] == "user":
            content = chat_messages[index]["content"]
            head = [{"type": "text", "text": content}] if isinstance(content, str) else content
            chat_messages[index] = {"role": "user", "content": [*head, *blocks]}

    # What changes from turn to turn: the time, who asks, and the Decisions as of right now. It goes
    # after the conversation (inside the last turn, see _stream_text), so the conversation and its
    # files can be cached, and a fresh pin still comes last and outweighs earlier replies.
    # Worded as a note, not "you are answering X": the model once opened a reply with that line.
    asked_at = f", sent {when(until, tz)}" if until else ""
    system_volatile = (
        f"[Note from the Choir app, not part of the message above. {today_line(tz)} The last message is "
        f"the one to answer (from {user_name_ctx}, {role_ctx.removeprefix('a ')}{asked_at}). Answer only it; "
        f"leave other people's earlier questions to their own replies unless it asks about them. Never "
        f"mention these notes or say whose message you are answering.]\n\n" + decisions_text + "\n\n" + tasks_now
    )

    # ── Stream from LLM ───────────────────────────────────────────────────────
    full_response = ""
    msg_id: str | None = None
    stream_failed = False
    sources: list[dict[str, str]] = []
    writing = False  # the last activity sent was "Writing the answer"

    # The `finally` below persists whatever text was generated even if this
    # generator is torn down early — e.g. the client disconnects mid-stream, in
    # which case Python raises GeneratorExit at the next `yield`. Previously
    # persistence only happened after the loop finished normally, so a dropped
    # connection silently discarded an otherwise fully-generated response. The
    # `finally` block must not attempt to yield (that raises RuntimeError while
    # a GeneratorExit is propagating), so `done` is only ever yielded after it.
    try:
        yield _sse({"activity": "Thinking"})
        while True:
            try:
                for chunk in _stream_text(
                    provider, model, api_key, system_stable, system_volatile, chat_messages,
                    search=provider == "anthropic" and wants_search,
                ):
                    if isinstance(chunk, dict):
                        if "sources" in chunk:
                            for found in chunk["sources"]:
                                if len(sources) < MAX_SOURCES and all(s["url"] != found["url"] for s in sources):
                                    sources.append(found)
                            yield _sse({"sources": sources})
                        if "activity" in chunk:
                            writing = False
                            yield _sse({"activity": chunk["activity"]})
                        continue
                    if not writing:
                        writing = True
                        yield _sse({"activity": "Writing the answer"})
                    full_response += chunk
                    yield _sse({"text": chunk})
                break

            except Exception as exc:
                if not shared_keys.is_rate_limit_error(exc):
                    stream_failed = True
                    yield _sse({"error": f"AI error: {exc}"})
                    break

                if is_shared and project and key_owner_id:
                    try:
                        shared_keys.notify_rate_limited(get_db(), key_owner_id, project, thread_id, provider)
                    except Exception:
                        logger.exception("Could not save the rate-limit notification")

                # Switch keys only before any text has streamed, so a reply never mixes two models.
                next_choice = _take_usable_key(spare_keys) if not full_response else None
                if not next_choice:
                    stream_failed = True
                    yield _sse(
                        {
                            "error": (
                                "Rate limit reached. Please check your API key usage limits "
                                "or try again later."
                            )
                        }
                    )
                    break

                candidate, api_key = next_choice
                # A provider with a smaller budget (Groq) gets the oldest turns dropped until it fits.
                if context_chars(candidate.provider) < context_chars(provider):
                    limit = context_chars(candidate.provider) - len(system_stable) - len(system_volatile)
                    while len(chat_messages) > 1 and sum(content_chars(m["content"]) for m in chat_messages) > limit:
                        chat_messages = chat_messages[1:]
                provider = candidate.provider
                model = candidate.model or _default_model(provider)
                key_owner_id = candidate.user_id
                lender = names.get(candidate.user_id) or "a teammate"
                yield _sse({"notice": f"Using {lender}'s key", "model": model})
    finally:
        # Persist whatever was generated so far — on a clean finish this is the
        # full response; on a disconnect or mid-stream provider error it's a
        # partial one, which still beats losing it outright.
        if full_response.strip():
            msg_id = _save_assistant_message(thread_id, full_response, provider, model, sources)

    if not stream_failed:
        # FU-4: a shared thread can end up using a different model than the one
        # the user picked (pooled/lent keys), so tell the client which one answered.
        yield _sse({"done": True, "message_id": msg_id, "model_provider": provider, "model_name": model})
        # Project memory catches up in the background, off the reply's critical path.
        if project:
            memory.refresh_in_background(thread["project_id"], provider, model, api_key, names, tz)


# ---------------------------------------------------------------------------
# "Catch Me Up" digest — one-shot, non-streaming summary of new messages
# ---------------------------------------------------------------------------


DIGEST_SYSTEM_PROMPT = prompts.system(prompts.DIGEST_JOB)

DIGEST_MAX_MESSAGES = 1_000
DIGEST_CONTEXT_MESSAGES = 10  # already-seen messages shown before the new ones, as context


def generate_digest(thread_id: str, user_id: str, tz_offset: int | None = None) -> dict[str, Any]:
    """
    Summarizes shared-thread messages the caller hasn't seen yet, using their own
    BYOK key (never the shared thread owner's — this is a personal, read-only
    convenience action, not part of the canonical conversation).

    Every new message is read: the ones that fit go in word for word, and the older
    rest is condensed first (component #4: a long absence no longer skips the middle).

    Returns {"summary": str, "message_count": int}.
    Raises NoApiKeyError if the user has no saved key, or RuntimeError on an
    upstream provider error (rate limit, etc).
    """
    thread = _fetch_thread(thread_id)
    if not thread:
        raise ValueError("Thread not found.")

    resolved = _resolve_provider_and_model(thread, user_id)
    if not resolved:
        raise NoApiKeyError(
            "No API key found. Please add one in Settings → API Keys before using Catch Me Up."
        )

    provider, model, api_key = resolved
    tz = user_tz(tz_offset)

    last_seen = _fetch_thread_read(thread_id, user_id)
    skipped = 0
    if last_seen:
        new_messages: list[dict[str, Any]] = []
        after: str | None = last_seen
        # ponytail: reads every new message up to a hard stop of 5 pages beyond the cap; a
        # longer absence than that only loses the oldest of the skipped ones from the count.
        while len(new_messages) < DIGEST_MAX_MESSAGES + 5 * FETCH_PAGE:
            page, raw = _fetch_page(thread_id, after, newest=False)
            new_messages += page
            if raw < FETCH_PAGE or not page:
                break
            after = page[-1]["created_at"]
        # A very long absence: the newest ones matter most, so drop the oldest and say so.
        if len(new_messages) > DIGEST_MAX_MESSAGES:
            skipped = len(new_messages) - DIGEST_MAX_MESSAGES
            new_messages = new_messages[-DIGEST_MAX_MESSAGES:]
    else:
        # Never used Catch me up here: just the latest 30, as before.
        new_messages, _ = _fetch_page(thread_id, newest=True, limit=30)
    now_iso = datetime.now(timezone.utc).isoformat()

    if not new_messages:
        _upsert_thread_read(thread_id, user_id, now_iso)
        return {
            "summary": "You're all caught up — no new messages since your last check.",
            "message_count": 0,
        }

    names = team_names_for_thread(thread)
    budget = context_chars(provider)
    recent, older = _fit(new_messages, budget // 2)
    # A few messages they'd already seen, files included, so new ones that point back ("here's the
    # product" about a PDF sent before their last catch-up) make sense (live failure: it asked the
    # person to share the document).
    seen: list[dict[str, Any]] = []
    if last_seen:
        seen, _ = _fetch_page(thread_id, None, last_seen, newest=True, limit=DIGEST_CONTEXT_MESSAGES)
        seen, _ = _fit(seen, budget // 6)
    parts = []
    if older:
        parts.append("EARLIER NEW MESSAGES (condensed):\n" + fold("", older, names, tz, provider, model, api_key))
    parts.append("LATEST NEW MESSAGES:\n")
    # prompts.DIGEST_JOB: the helper must know exactly what range it was given.
    if not last_seen:
        coverage = (
            f"COVERAGE: only the latest {len(new_messages)} messages, because this person hasn't used "
            "Catch me up in this thread before. Earlier messages are not included."
        )
    else:
        coverage = (
            f"COVERAGE: the latest {len(new_messages)} messages sent since this person last caught up "
            f"({when(last_seen, tz)})"
            + (f"; the earliest {len(older)} of these are condensed, the latest {len(recent)} are word for word" if older else ", word for word")
            + (f". {skipped} earlier new messages were not included." if skipped else ".")
            + (f" Before them come the last {len(seen)} messages they had already seen, as context only." if seen else "")
        )
    # Messages carry their opened files, as in the chat (newest first within the caps).
    head = f"{today_line(tz)}\n{coverage}\n\n"
    if seen:
        head += "ALREADY SEEN (context only; never report these as new):\n"
    new_heading = "\n\n".join(parts)

    def render(m: dict[str, Any]) -> str:
        return (new_heading if seen and m is recent[0] else "") + transcript([m], names, tz)

    # Feature D: What got done / Who's doing what come from the task list, never from chat.
    tasks_part = tasks_text(thread["project_id"], names, tz, budget // 10, done_since=last_seen) + "\n\n"
    user_prompt = with_files(tasks_part + (head if seen else head + new_heading), seen + recent, render, provider)

    summary = complete_once(provider, model, api_key, DIGEST_SYSTEM_PROMPT, user_prompt, max_tokens=700)

    _upsert_thread_read(thread_id, user_id, now_iso)
    return {"summary": summary.strip(), "message_count": len(new_messages) + skipped}
