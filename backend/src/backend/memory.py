"""
Component #4: project memory. One shared, always-current set of notes per project that
every AI call reads, and the whole team can see and correct.

Built from Team Space only, never from private threads (one-way context). Every item
cites the Team Space messages it came from. The AI keeps its own items ("by": "ai")
current; an item a person wrote or edited ("by": their user id) is theirs, and the AI
never changes or removes it. Decisions aren't stored here: prompts read them live from
the pins (llm.decisions_block), so memory can't drift from what the team pinned.

Database access goes through `llm.get_db` so tests that patch it cover this module too.
"""

import json
import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from backend import llm, prompts

logger = logging.getLogger(__name__)

SECTIONS = {
    "goal": "What we're building",
    "facts": "Facts and constraints",
    "open": "Open questions",
    "owners": "Who's doing what",
}
REFRESH_EVERY = 8  # new Team Space messages before the AI updates memory on its own
# Capacity policy (prompts.MEMORY_JOB states the same numbers): up to 50 AI notes, each
# under ~100 words. A longer note is rejected whole, never cut mid-sentence (a cut can change
# its meaning); anything past 50 is dropped with a log line.
MAX_AI_NOTES = 50
MAX_ITEM_CHARS = 700
READ_LIMIT = 300  # Team Space messages read per update

MEMORY_SYSTEM_PROMPT = prompts.system(prompts.MEMORY_JOB)


def get(project_id: str) -> dict[str, Any] | None:
    rows = cast(list[dict[str, Any]], llm.get_db().table("project_memory").select("*").eq("project_id", project_id).execute().data)
    return rows[0] if rows else None


def shared_thread_id(project_id: str) -> str | None:
    rows = cast(list[dict[str, Any]], (
        llm.get_db().table("threads").select("id").eq("project_id", project_id).eq("type", "shared").execute().data
    ))
    return rows[0]["id"] if rows else None


def render(project_id: str, budget_chars: int) -> str:
    """The memory as a prompt block, grouped by section, cut to the budget."""
    row = get(project_id)
    items = (row or {}).get("items") or []
    if not items:
        return ""
    lines = [
        "PROJECT MEMORY (the team's shared notes, kept current by Choir from Team Space and edited by "
        "the team; notes marked (AI) were written by Choir and can be wrong, the rest were written by "
        "a person):"
    ]
    for key, title in SECTIONS.items():
        section = [i for i in items if i.get("section") == key]
        if section:
            lines.append(f"{title}:")
            lines += [f"- {i.get('text', '').strip()}{' (AI)' if i.get('by') == 'ai' else ''}" for i in section]
    text = "\n".join(lines)
    return text if len(text) <= budget_chars else text[:budget_chars] + "\n(...more notes not shown)"


def _parse(raw: str) -> list[dict[str, Any]] | None:
    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


def _validate(proposed: list[Any], known_ids: set[str], ai_ids: set[str]) -> list[dict[str, Any]]:
    """
    Keep only well-formed notes that cite at least one message the AI was actually shown.
    An over-long note is rejected whole (never cut mid-sentence); an id used twice, or one
    belonging to a person's note, becomes a new note; past MAX_AI_NOTES the rest are dropped.
    """
    notes: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for item in proposed:
        if not isinstance(item, dict) or item.get("section") not in SECTIONS:
            continue
        text = str(item.get("text") or "").strip()
        sources = [str(s) for s in item.get("sources") or [] if str(s) in known_ids]
        if not text or not sources:
            continue
        if len(text) > MAX_ITEM_CHARS:
            logger.info("Rejected an over-long project memory note (%d chars)", len(text))
            continue
        note_id = str(item.get("id") or "")
        if note_id not in ai_ids or note_id in used_ids:
            note_id = str(uuid.uuid4())
        used_ids.add(note_id)
        notes.append({
            "id": note_id,
            "section": item["section"],
            "text": text,
            "sources": list(dict.fromkeys(sources)),
            "by": "ai",
        })
    if len(notes) > MAX_AI_NOTES:
        logger.warning("Project memory update returned %d notes; kept the first %d", len(notes), MAX_AI_NOTES)
    return notes[:MAX_AI_NOTES]


def refresh(
    project_id: str, provider: str, model: str, api_key: str, names: dict[str, str],
    tz: timezone = timezone.utc, *, force: bool = False,
) -> dict[str, Any] | None:
    """
    Fold new Team Space messages into the memory. Without `force`, waits until at least
    REFRESH_EVERY new messages have arrived. Returns the (possibly unchanged) row.
    """
    thread_id = shared_thread_id(project_id)
    if not thread_id:
        return None
    row = get(project_id)
    after = (row or {}).get("covers_through")
    # First build of a long Team Space: the newest READ_LIMIT messages (its compact
    # checkpoint covers the rest). Later updates: everything since the last one.
    messages, _ = llm._fetch_page(thread_id, after, newest=not after, limit=READ_LIMIT)
    if not messages or (not force and len(messages) < REFRESH_EVERY):
        return row

    items = list((row or {}).get("items") or [])
    people_notes = [i for i in items if i.get("by") != "ai"]
    ai_notes = [i for i in items if i.get("by") == "ai"]
    decisions = llm._team_decisions(project_id)
    known_ids = {m["id"] for m in messages} | {d["id"] for d in decisions}
    known_ids |= {s for i in items for s in i.get("sources") or []}

    shown = [{**i, "locked": i.get("by") != "ai"} for i in items]
    parts = [
        "CURRENT NOTES (JSON; locked = written by a person):\n" + json.dumps(
            [{k: n.get(k) for k in ("id", "section", "text", "sources", "locked")} for n in shown]
        ),
        "TEAM DECISIONS (pinned):\n" + "\n".join(f"- [msg:{d['id']}] {d.get('content', '').strip()}" for d in decisions)
        if decisions else "TEAM DECISIONS: none pinned yet.",
    ]
    if not after:
        checkpoint = llm._latest_checkpoint(thread_id)
        if checkpoint:
            parts.append(
                "EARLIER TEAM SPACE (compact summary with no message ids: background only, it cannot "
                "support a new note):\n" + checkpoint["content"]
            )
    parts.append("NEW TEAM SPACE MESSAGES:\n" + (llm.transcript(messages, names, tz, ids=True) or "(none)"))

    started = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    raw = llm.complete_once(provider, model, api_key, MEMORY_SYSTEM_PROMPT, "\n\n".join(parts), max_tokens=2000)
    proposed = _parse(raw)
    if proposed is None:
        logger.warning("Project memory update for %s returned no JSON list; keeping the old notes", project_id)
        return row

    fresh = _validate(proposed, known_ids, {n["id"] for n in ai_notes})
    covers = messages[-1]["created_at"] if messages else after
    saved = _save(project_id, row, fresh, covers)

    # withdraw_publication() drops notes citing a withdrawn post in the same transaction as the
    # withdrawal. Notes written from messages read before it ran can still cite it, so drop
    # those again after our write.
    withdrawn = cast(list[dict[str, Any]], (
        llm.get_db().table("messages").select("id").eq("thread_id", thread_id).gte("withdrawn_at", started).execute().data
    ))
    if saved and withdrawn:
        gone = {w["id"] for w in withdrawn}
        kept = [i for i in saved["items"] if not gone & set(i.get("sources") or [])]
        if len(kept) != len(saved["items"]):
            saved = _save(project_id, saved, [i for i in kept if i.get("by") == "ai"], saved.get("covers_through"))
    return saved


def _save(project_id: str, row: dict[str, Any] | None, ai_notes: list[dict[str, Any]], covers: str | None) -> dict[str, Any] | None:
    """
    Write people's notes (re-read, so an edit made meanwhile is kept) plus the AI's notes.
    A version check means a person's edit landing mid-write makes us re-read and retry once.
    """
    db = llm.get_db()
    for _ in range(2):
        current = get(project_id)
        # A slower update over older messages must not overwrite a newer one's notes or move
        # coverage backwards (codex review): keep what's there and drop this result.
        stored = (current or {}).get("covers_through")
        if stored and (not covers or covers < stored):
            logger.info("Dropped a stale project memory update for %s", project_id)
            return current
        people = [i for i in (current or {}).get("items") or [] if i.get("by") != "ai"]
        items = people + ai_notes[:MAX_AI_NOTES]
        values = {
            "items": items,
            "covers_through": covers,
            "updated_by": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if current is None:
            rows = cast(list[dict[str, Any]], db.table("project_memory").insert({"project_id": project_id, "version": 1, **values}).execute().data)
        else:
            rows = cast(list[dict[str, Any]], (
                db.table("project_memory")
                .update({**values, "version": current["version"] + 1})
                .eq("project_id", project_id)
                .eq("version", current["version"])
                .execute()
                .data
            ))
        if rows:
            return rows[0]
    logger.warning("Project memory for %s kept changing; skipped this update", project_id)
    return row


def refresh_in_background(
    project_id: str, provider: str, model: str, api_key: str, names: dict[str, str], tz: timezone
) -> None:
    """
    After an AI reply: update memory if enough has happened, without holding up the reply.
    One update per project at a time in this process; a reply finishing meanwhile skips it
    (the next reply picks up whatever it would have read).
    """
    with _running_lock:
        if project_id in _running:
            return
        _running.add(project_id)

    def run() -> None:
        try:
            refresh(project_id, provider, model, api_key, names, tz)
        except Exception:
            logger.exception("Background project memory update failed for %s", project_id)
        finally:
            with _running_lock:
                _running.discard(project_id)

    threading.Thread(target=run, daemon=True).start()


# ponytail: per-process only; with several backend workers, the stale check in _save is
# what keeps a slower update from winning.
_running: set[str] = set()
_running_lock = threading.Lock()
