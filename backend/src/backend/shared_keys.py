"""
Which saved keys may power a Team Space reply, in order (F3, F4, F5).

Teammates can lend a saved key to one project (`shared_keys`):
  - mode 'pool':     Team Space requests rotate across pooled keys, least recently used first.
  - mode 'fallback': used only after the key in use hits a provider rate limit.

Order for a Team Space reply: pool keys (LRU), then the project owner's key, then fallback keys.
Nothing here decrypts a key; the caller decrypts only the candidate it actually tries.
Lent keys are only ever read for the project they were lent to, and only for shared threads.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, cast

from supabase import Client

RATE_LIMIT_KIND = "key_rate_limited"
NOTIFY_WINDOW = timedelta(minutes=10)


@dataclass(frozen=True)
class KeyCandidate:
    user_id: str
    provider: str
    # None means "that provider's default model".
    model: str | None
    # The shared_keys row, or None for the owner's own key.
    shared_key_id: str | None = None


def is_rate_limit_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "429" in err or "rate_limit" in err or "quota" in err


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _team_member_ids(db: Client, team_id: str) -> set[str]:
    resp = db.table("team_members").select("user_id").eq("team_id", team_id).execute()
    return {row["user_id"] for row in cast(list[dict[str, Any]], resp.data)}


def _lent_rows(db: Client, project_id: str) -> list[dict[str, Any]]:
    resp = (
        db.table("shared_keys")
        .select("id, user_id, provider, mode, last_used_at")
        .eq("project_id", project_id)
        .order("last_used_at", nullsfirst=True)
        .execute()
    )
    return cast(list[dict[str, Any]], resp.data)


def plan_keys(
    db: Client, project: dict[str, Any] | None, providers: list[str]
) -> tuple[list[KeyCandidate], list[KeyCandidate]]:
    """
    (first choices, fallbacks) for a Team Space reply, best first.
    First choices are pool keys (LRU) then the owner's key. Fallbacks are only for
    after a rate limit. Both are empty if the project has no owner.
    """
    if not project or not project.get("created_by"):
        return [], []

    shared_provider = project.get("shared_model_provider") or "anthropic"
    shared_model = project.get("shared_model_name")

    rows = _lent_rows(db, project["id"])
    if rows and project.get("team_id"):
        # Someone who has left the team no longer lends anything.
        members = _team_member_ids(db, project["team_id"])
        rows = [row for row in rows if row["user_id"] in members]
    else:
        rows = []

    def lent(mode: str) -> list[KeyCandidate]:
        return [
            KeyCandidate(
                row["user_id"],
                row["provider"],
                shared_model if row["provider"] == shared_provider else None,
                row["id"],
            )
            for row in rows
            if row.get("mode") == mode
        ]

    owner = KeyCandidate(project["created_by"], shared_provider, shared_model)

    # Drop unknown providers, and the same person's key for the same provider twice.
    seen: set[tuple[str, str]] = set()

    def keep(candidates: list[KeyCandidate]) -> list[KeyCandidate]:
        kept = []
        for candidate in candidates:
            pair = (candidate.user_id, candidate.provider)
            if candidate.provider in providers and pair not in seen:
                seen.add(pair)
                kept.append(candidate)
        return kept

    first = keep(lent("pool") + [owner])
    return first, keep(lent("fallback"))


def mark_used(db: Client, shared_key_id: str) -> None:
    db.table("shared_keys").update({"last_used_at": _now().isoformat()}).eq("id", shared_key_id).execute()


def notify_rate_limited(db: Client, user_id: str, project: dict[str, Any], thread_id: str, provider: str) -> bool:
    """Tell a key's owner it hit a rate limit, at most once per owner and project per 10 minutes."""
    since = (_now() - NOTIFY_WINDOW).isoformat()
    recent = (
        db.table("notifications")
        .select("id")
        .eq("user_id", user_id)
        .eq("project_id", project["id"])
        .eq("kind", RATE_LIMIT_KIND)
        .gte("created_at", since)
        .limit(1)
        .execute()
    )
    if recent.data:
        return False
    db.table("notifications").insert(
        {
            "user_id": user_id,
            "team_id": project.get("team_id"),
            "project_id": project["id"],
            "kind": RATE_LIMIT_KIND,
            "payload": {
                "provider": provider,
                "project_name": project.get("name") or "",
                "thread_id": thread_id,
            },
        }
    ).execute()
    return True
