"""
M1/M2 spike: connecting a coding agent (Claude Code, Cursor, Codex...) to a Choir
project via MCP.

An "agent" is a real, synthetic auth.users account owned by the person who
connected it — not a parallel identity system. That means it's already a normal
team_members row and a normal messages.sender_id everywhere else in the app: no
RLS or foreign-key changes needed for it to post to Team Space or show up in the
roster. The only new things are profiles.kind/owner_id (so the UI can badge it)
and this module, which creates that account and authenticates the agent's own
requests with a hashed token instead of a Supabase session.
"""

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any, cast

from backend.db import get_db, verify_team_access
from backend.llm import sender_label, team_names_for_thread

MESSAGE_CONTEXT_LIMIT = 30


class AgentError(Exception):
    """Raised for problems the API layer should turn into a 4xx."""


class AgentContext:
    def __init__(self, agent_user_id: str, owner_id: str, project_id: str, team_id: str):
        self.agent_user_id = agent_user_id
        self.owner_id = owner_id
        self.project_id = project_id
        self.team_id = team_id


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _project_team_id(project_id: str) -> str | None:
    resp = get_db().table("projects").select("team_id").eq("id", project_id).execute()
    data = cast(list[dict[str, Any]], resp.data)
    return data[0]["team_id"] if data else None


def _shared_thread(project_id: str) -> dict[str, Any] | None:
    resp = get_db().table("threads").select("*").eq("project_id", project_id).eq("type", "shared").execute()
    data = cast(list[dict[str, Any]], resp.data)
    return data[0] if data else None


def _ensure_agent_account(owner_id: str, team_id: str) -> str:
    """
    The one synthetic account for this person's agent, created the first time they
    connect a coding tool and reused after that — "Priya's Claude Code" and
    "Priya's Cursor" are the same member, just posting from different tools.
    """
    db = get_db()

    existing = db.table("profiles").select("id").eq("owner_id", owner_id).eq("kind", "agent").execute()
    existing_data = cast(list[dict[str, Any]], existing.data)
    if existing_data:
        agent_user_id = existing_data[0]["id"]
    else:
        owner_resp = db.table("profiles").select("display_name").eq("id", owner_id).execute()
        owner_data = cast(list[dict[str, Any]], owner_resp.data)
        owner_name = (owner_data[0].get("display_name") if owner_data else None) or "Someone"

        created = db.auth.admin.create_user(
            {
                "email": f"agent+{secrets.token_hex(8)}@agents.choir.internal",
                "email_confirm": True,
                # Random and never shown to anyone; this account has no way to log in.
                "password": secrets.token_urlsafe(32),
                "user_metadata": {"is_choir_agent": True},
            }
        )
        agent_user_id = created.user.id

        # schema.sql's create_profile_on_signup trigger already inserted a bare
        # profiles row for this new auth.users account (on conflict do nothing,
        # display_name from the synthetic email) -- upsert to fill in the real
        # name, kind and owner instead of colliding with it.
        db.table("profiles").upsert(
            {
                "id": agent_user_id,
                "display_name": f"{owner_name}'s Agent",
                "kind": "agent",
                "owner_id": owner_id,
            },
            on_conflict="id",
        ).execute()

    # Idempotent — fine to call even if it's already a member of this team.
    db.table("team_members").upsert(
        {"team_id": team_id, "user_id": agent_user_id, "role": "member"},
        on_conflict="team_id,user_id",
    ).execute()

    return agent_user_id


def create_agent_connection(owner_id: str, project_id: str, kind: str) -> dict[str, str]:
    """Create (or reuse) the owner's agent account and mint a new token for this project."""
    team_id = _project_team_id(project_id)
    if not team_id or not verify_team_access(owner_id, team_id):
        raise AgentError("You don't have access to that project.")

    agent_user_id = _ensure_agent_account(owner_id, team_id)

    raw_token = secrets.token_urlsafe(32)
    get_db().table("agent_connections").insert(
        {
            "agent_user_id": agent_user_id,
            "owner_id": owner_id,
            "project_id": project_id,
            "name": kind or "Agent",
            "kind": kind,
            "token_hash": _hash_token(raw_token),
        }
    ).execute()

    return {"token": raw_token, "agent_user_id": agent_user_id}


def resolve_agent_token(raw_token: str) -> AgentContext | None:
    """The MCP server's auth check: hash the incoming token and look it up."""
    db = get_db()
    token_hash = _hash_token(raw_token)
    resp = (
        db.table("agent_connections")
        .select("agent_user_id, owner_id, project_id")
        .eq("token_hash", token_hash)
        .execute()
    )
    data = cast(list[dict[str, Any]], resp.data)
    if not data:
        return None
    row = data[0]
    team_id = _project_team_id(row["project_id"])
    if not team_id:
        return None

    db.table("agent_connections").update({"last_seen_at": datetime.now(timezone.utc).isoformat()}).eq(
        "token_hash", token_hash
    ).execute()

    return AgentContext(row["agent_user_id"], row["owner_id"], row["project_id"], team_id)


def set_agent_status(agent_user_id: str, status: str) -> None:
    """Silent — a sidebar/status update, never a Team Space message."""
    get_db().table("profiles").update({"status": status}).eq("id", agent_user_id).execute()


def post_agent_message(agent_user_id: str, project_id: str, content: str) -> str:
    thread = _shared_thread(project_id)
    if not thread:
        raise AgentError("This project has no Team Space thread.")
    resp = (
        get_db()
        .table("messages")
        .insert({"thread_id": thread["id"], "sender_type": "user", "sender_id": agent_user_id, "content": content})
        .execute()
    )
    data = cast(list[dict[str, Any]], resp.data)
    return data[0]["id"]


def read_team_space(project_id: str) -> str:
    """Plain-text context for the connecting agent: current Decisions + recent messages."""
    thread = _shared_thread(project_id)
    if not thread:
        return "This project has no Team Space thread yet."

    db = get_db()
    names = team_names_for_thread(thread)

    decisions_resp = (
        db.table("messages")
        .select("content, created_at, sender_type, sender_id")
        .eq("thread_id", thread["id"])
        .eq("is_decision", True)
        .order("created_at")
        .execute()
    )
    decisions = cast(list[dict[str, Any]], decisions_resp.data)

    recent_resp = (
        db.table("messages")
        .select("content, created_at, sender_type, sender_id")
        .eq("thread_id", thread["id"])
        .order("created_at", desc=True)
        .limit(MESSAGE_CONTEXT_LIMIT)
        .execute()
    )
    recent = list(reversed(cast(list[dict[str, Any]], recent_resp.data)))

    lines: list[str] = []
    if decisions:
        lines.append(f"DECISIONS ({len(decisions)}):")
        for msg in decisions:
            lines.append(f"- {sender_label(msg, names)}: {msg['content']}")
        lines.append("")

    lines.append(f"RECENT TEAM SPACE MESSAGES (last {len(recent)}):")
    for msg in recent:
        lines.append(f"{sender_label(msg, names)}: {msg['content']}")

    return "\n".join(lines)
