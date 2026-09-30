from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import random
import re
from typing import Any, cast

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.agent_mcp import mcp_server
from backend.agents import AgentError, create_agent_connection
from backend.auth import get_current_user
from backend.db import find_missing_tables, get_accessible_thread, get_db, verify_thread_access
from backend.errors import ErrorMiddleware, safe_sse_stream
from backend.findings import draft_findings
from backend.files import attachments_of, human_size, kind as file_kind
from backend.handoff import draft_handoff_prompt
from backend.keys import (
    delete_api_key,
    list_saved_providers,
    store_api_key,
)
from backend import memory
from backend.llm import (
    NoApiKeyError,
    compact_now,
    compact_room,
    generate_digest,
    resolve_key,
    sender_label,
    stream_ai_response,
    team_names_for_thread,
    user_tz,
)

logging.basicConfig(level=logging.INFO)

DEFAULT_ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"


def parse_allowed_origins(value: str | None) -> list[str]:
    """Comma-separated list of frontend origins allowed to call this backend."""
    return [origin.strip().rstrip("/") for origin in (value or DEFAULT_ALLOWED_ORIGINS).split(",") if origin.strip()]


# M1 spike: the MCP server a connected coding agent talks to directly, with its own
# hashed-token auth (see agent_mcp.py) instead of this app's normal JWT auth. Built
# once here (not inside app.mount) because its lifespan has to be driven manually
# below -- see the comment in lifespan().
mcp_app = mcp_server.streamable_http_app(streamable_http_path="/")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Refuse to start against a database that is missing tables, instead of
    # failing later on the first request that touches them.
    missing = find_missing_tables(get_db())
    if missing:
        raise RuntimeError(
            "Supabase is missing required tables: "
            + ", ".join(missing)
            + ". Run schema.sql in the Supabase SQL Editor before starting the backend."
        )
    # app.mount() does not cascade ASGI lifespan startup/shutdown to a mounted
    # sub-app -- confirmed directly, not assumed. Without this, the MCP session
    # manager's task group never starts and every request 500s with "Task group
    # is not initialized". Running its lifespan_context here is what actually
    # starts it.
    async with mcp_app.router.lifespan_context(mcp_app):
        yield


app = FastAPI(title="Choir AI Backend", lifespan=lifespan)

# Order matters: the last middleware added runs first. ErrorMiddleware is added
# before CORSMiddleware so CORS wraps it and error responses keep CORS headers.
app.add_middleware(ErrorMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(os.getenv("ALLOWED_ORIGINS")),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/mcp", mcp_app)


# ──────────────────────────────────────────────────────────────────────────────
# Health check
# ──────────────────────────────────────────────────────────────────────────────


@app.get("/")
def read_root():
    return {"status": "ok", "message": "Choir Python Backend is running!"}



# ──────────────────────────────────────────────────────────────────────────────
# BYOK — API Key Management
# ──────────────────────────────────────────────────────────────────────────────


class SaveKeyRequest(BaseModel):
    provider: str  # "anthropic" | "openai" | "google" | "groq"
    api_key: str

VALID_PROVIDERS = {"anthropic", "openai", "google", "groq"}


@app.get("/api/keys")
def get_saved_keys(user_id: str = Depends(get_current_user)):
    """Return the list of providers for which the user has saved a key (not the keys themselves)."""
    providers = list_saved_providers(user_id)
    return {"saved_providers": providers}


@app.post("/api/keys", status_code=201)
def save_key(body: SaveKeyRequest, user_id: str = Depends(get_current_user)):
    """Encrypt and store (or update) a provider API key for the authenticated user."""
    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider '{body.provider}'. Must be one of: {', '.join(sorted(VALID_PROVIDERS))}",
        )
    if not body.api_key.strip():
        raise HTTPException(status_code=400, detail="api_key cannot be empty.")

    store_api_key(user_id, body.provider, body.api_key.strip())
    return {"message": f"API key for '{body.provider}' saved successfully."}


@app.delete("/api/keys/{provider}")
def remove_key(provider: str, user_id: str = Depends(get_current_user)):
    """Delete the stored API key for the given provider."""
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Invalid provider '{provider}'.")
    delete_api_key(user_id, provider)
    return {"message": f"API key for '{provider}' removed."}


# ──────────────────────────────────────────────────────────────────────────────
# M1/M2 spike — connecting a coding agent to a project
# ──────────────────────────────────────────────────────────────────────────────


class ConnectAgentRequest(BaseModel):
    project_id: str
    kind: str = "Agent"  # a free-text label, e.g. "Claude Code" -- not enforced


@app.post("/api/agents/connect", status_code=201)
def connect_agent(body: ConnectAgentRequest, user_id: str = Depends(get_current_user)):
    """
    Create (or reuse) this person's agent account and mint a new MCP token for a
    project. The raw token is returned once -- only its hash is ever stored.
    """
    try:
        return create_agent_connection(user_id, body.project_id, body.kind)
    except AgentError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


# ──────────────────────────────────────────────────────────────────────────────
# AI Chat — streaming endpoint
# ──────────────────────────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    thread_id: str
    model_provider: str | None = None
    model_name: str | None = None
    user_name: str | None = None
    # Component #4: the message that asked, and the browser's getTimezoneOffset().
    message_id: str | None = None
    tz_offset: int | None = None


MAX_REQUESTS_PER_MINUTE = 15
# How often the opportunistic cleanup below actually runs (see _check_and_record_rate_limit).
CLEANUP_PROBABILITY = 0.02


def _check_and_record_rate_limit(user_id: str) -> None:
    """
    Shared rate limit for any endpoint that makes an LLM call on the user's behalf.

    Backed by the `ai_request_log` table rather than an in-memory counter, so
    the limit survives backend restarts and is enforced correctly even when
    multiple backend instances are running behind a load balancer.
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(seconds=60)).isoformat()

    # Opportunistic cleanup so the log table doesn't grow unbounded. This used to run
    # on every request, which cost a whole round trip to Supabase (300-500ms) on every
    # single AI call just to delete rows that are almost always already gone. Once in
    # every ~50 requests keeps the table just as small and avoids a cron job.
    if random.random() < CLEANUP_PROBABILITY:
        stale_cutoff = (now - timedelta(hours=1)).isoformat()
        db.table("ai_request_log").delete().lt("requested_at", stale_cutoff).execute()

    recent = (
        db.table("ai_request_log")
        .select("id")
        .eq("user_id", user_id)
        .gt("requested_at", window_start)
        .execute()
    )
    if len(recent.data or []) >= MAX_REQUESTS_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. You can only make {MAX_REQUESTS_PER_MINUTE} requests per minute.",
        )

    db.table("ai_request_log").insert({"user_id": user_id}).execute()


@app.post("/api/chat")
def chat(body: ChatRequest, user_id: str = Depends(get_current_user)):
    """
    Trigger an AI response for the given thread.

    - Verifies the user has access to the thread.
    - Assembles context (shared thread injected as system prompt for private threads).
    - Streams the LLM response as Server-Sent Events (SSE).
    - Persists the final response to Supabase once streaming is complete.
    """
    _check_and_record_rate_limit(user_id)

    thread = get_accessible_thread(user_id, body.thread_id)
    if not thread:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this thread.",
        )

    return StreamingResponse(
        safe_sse_stream(
            stream_ai_response(
                body.thread_id, user_id, body.model_provider, body.model_name, body.user_name, thread=thread,
                message_id=body.message_id, tz_offset=body.tz_offset,
            )
        ),
        media_type="text/event-stream",
        headers={
            # Prevent buffering in proxies / Next.js dev server
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ──────────────────────────────────────────────────────────────────────────────
# "Catch Me Up" — one-shot AI digest of new shared-thread messages
# ──────────────────────────────────────────────────────────────────────────────


@app.post("/api/digest/{thread_id}")
def get_digest(thread_id: str, tz_offset: int | None = None, user_id: str = Depends(get_current_user)):
    """
    Summarize what's new in a thread since the caller last used this feature,
    using their own BYOK key. Non-streaming — the response is short by design.
    """
    _check_and_record_rate_limit(user_id)

    if not verify_thread_access(user_id, thread_id):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this thread.",
        )

    try:
        return generate_digest(thread_id, user_id, tz_offset)
    except NoApiKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ──────────────────────────────────────────────────────────────────────────────
# "Publish findings" — AI draft of a Team Space post from a private thread (K2)
# ──────────────────────────────────────────────────────────────────────────────


@app.post("/api/findings/{thread_id}")
def get_findings_draft(thread_id: str, user_id: str = Depends(get_current_user)):
    """Draft a summary / recommendation / open questions post. Nothing is posted here."""
    _check_and_record_rate_limit(user_id)

    if not verify_thread_access(user_id, thread_id):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this thread.",
        )

    try:
        return draft_findings(thread_id, user_id)
    except NoApiKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/export-prompt/{thread_id}")
def get_export_prompt(thread_id: str, user_id: str = Depends(get_current_user)):
    """AI-written prompt for carrying the thread into another AI chat. Nothing is saved."""
    _check_and_record_rate_limit(user_id)

    if not verify_thread_access(user_id, thread_id):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this thread.",
        )

    try:
        return draft_handoff_prompt(thread_id, user_id)
    except NoApiKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ──────────────────────────────────────────────────────────────────────────────
# Component #4 — Compact (visible context checkpoints) and project memory
# ──────────────────────────────────────────────────────────────────────────────


class CompactRequest(BaseModel):
    focus: str | None = None
    tz_offset: int | None = None


@app.get("/api/compact/{thread_id}")
def compact_status(thread_id: str, user_id: str = Depends(get_current_user)):
    """How full the AI's reading room is for this thread, so Compact can say why it's not needed yet."""
    thread = get_accessible_thread(user_id, thread_id)
    if not thread:
        raise HTTPException(status_code=403, detail="You do not have access to this thread.")
    resolved = resolve_key(thread, user_id)
    return compact_room(thread_id, resolved[0] if resolved else "anthropic")


@app.post("/api/compact/{thread_id}", status_code=201)
def compact_thread_now(thread_id: str, body: CompactRequest, user_id: str = Depends(get_current_user)):
    """Fold the thread (all but its last few messages) into a new visible checkpoint card."""
    _check_and_record_rate_limit(user_id)
    thread = get_accessible_thread(user_id, thread_id)
    if not thread:
        raise HTTPException(status_code=403, detail="You do not have access to this thread.")
    try:
        checkpoint = compact_now(thread, user_id, (body.focus or "")[:500] or None, body.tz_offset)
    except NoApiKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"id": checkpoint["id"]}


@app.post("/api/checkpoints/{message_id}/undo")
def undo_checkpoint(message_id: str, user_id: str = Depends(get_current_user)):
    """Undo a compact: the card disappears and the AI goes back to the previous summary."""
    db = get_db()
    rows = cast(
        list[dict[str, Any]],
        db.table("messages").select("id, thread_id, kind, withdrawn_at").eq("id", message_id).execute().data,
    )
    checkpoint = rows[0] if rows else None
    if not checkpoint or checkpoint.get("kind") != "checkpoint" or not verify_thread_access(user_id, checkpoint["thread_id"]):
        raise HTTPException(status_code=404, detail="That compact no longer exists.")
    if not checkpoint.get("withdrawn_at"):
        db.table("messages").update({"withdrawn_at": datetime.now(timezone.utc).isoformat()}).eq("id", message_id).execute()
    return {"ok": True}


class MemoryRefreshRequest(BaseModel):
    tz_offset: int | None = None


@app.post("/api/memory/{project_id}/refresh")
def refresh_project_memory(project_id: str, body: MemoryRefreshRequest, user_id: str = Depends(get_current_user)):
    """Fold the latest Team Space messages into project memory now, with the same key @AI uses there."""
    _check_and_record_rate_limit(user_id)
    thread_id = memory.shared_thread_id(project_id)
    thread = get_accessible_thread(user_id, thread_id) if thread_id else None
    if not thread:
        raise HTTPException(status_code=403, detail="You do not have access to this project.")
    resolved = resolve_key(thread, user_id)
    if not resolved:
        raise HTTPException(
            status_code=400,
            detail="No API key found. Please add one in Settings → API Keys before updating memory.",
        )
    provider, model, api_key = resolved
    try:
        row = memory.refresh(
            project_id, provider, model, api_key, team_names_for_thread(thread), user_tz(body.tz_offset), force=True
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"items": (row or {}).get("items") or [], "covers_through": (row or {}).get("covers_through")}


# ──────────────────────────────────────────────────────────────────────────────
# Export — separate from /api/chat to avoid route shadowing
# ──────────────────────────────────────────────────────────────────────────────


def _published_from(msg: dict[str, Any], names: dict[str, str]) -> str | None:
    """K2: a post published from a private thread names only its owner (who is the poster)."""
    if not msg.get("source_thread_id"):
        return None
    return f"{sender_label(msg, names)}'s private thread"


def _safe_filename(name: str) -> str:
    """
    Convert a thread name into a safe filename.
    Strips anything that isn't a word char, space, or hyphen,
    then replaces spaces with underscores and lowercases the result.
    """
    sanitized = re.sub(r"[^\w\s\-]", "", name)
    sanitized = re.sub(r"\s+", "_", sanitized.strip())
    return (sanitized or "thread").lower()


@app.get("/api/export/{thread_id}")
def export_thread(thread_id: str, format: str = "md", user_id: str = Depends(get_current_user)):
    """
    Export all messages in a thread.
    - If format=json, exports raw JSON data with full metadata.
    - If format=md, exports formatted Markdown.
    """
    db = get_db()

    # 1. Verify access
    if not verify_thread_access(user_id, thread_id):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this thread.",
        )

    # 2. Fetch thread metadata
    thread_resp = db.table("threads").select("*").eq("id", thread_id).single().execute()
    thread = thread_resp.data
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    thread_name = thread.get("name") or "Untitled Thread"

    # 3. Fetch messages
    msg_resp = (
        db.table("messages")
        .select("*")
        .eq("thread_id", thread_id)
        .order("created_at")
        .execute()
    )
    messages = cast(list[dict[str, Any]], msg_resp.data)
    names = team_names_for_thread(thread)

    if format == "json":
        export_data = {
            "thread": thread,
            "messages": [
                {**msg, "sender_name": sender_label(msg, names), "published_from": _published_from(msg, names)}
                for msg in messages
            ],
            "exported_at": datetime.now(timezone.utc).isoformat()
        }
        filename = f"{_safe_filename(thread_name)}_export.json"

        return Response(
            content=json.dumps(export_data, indent=2, default=str),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            },
        )

    # Fallback to Markdown format
    md_lines = []
    md_lines.append(f"# {thread_name}")
    md_lines.append(f"**Exported:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    md_lines.append(f"**Type:** {thread.get('type', 'Unknown').capitalize()}")
    md_lines.append("")
    md_lines.append("---")
    md_lines.append("")

    for msg in messages:
        sender = sender_label(msg, names)
        model = msg.get("model_name")
        if model and msg["sender_type"] == "assistant":
            sender += f" ({model})"

        if msg.get("kind") == "checkpoint":
            # Component #4: a compact card; an undone one isn't part of the record.
            if not msg.get("withdrawn_at"):
                md_lines += [f"_Context compacted ({msg.get('covers_count') or 0} messages):_", "", msg["content"], "", "---", ""]
            continue
        md_lines.append(f"**{sender}:**")
        if msg.get("withdrawn_at"):
            md_lines += ["", "_Withdrew a post._", "", "---", ""]
            continue
        published_from = _published_from(msg, names)
        if published_from:
            md_lines.append(f"_Published from {published_from}_")
        md_lines.append("")
        if msg["content"]:
            md_lines.append(msg["content"])
        for file in attachments_of(msg):
            md_lines.append(f"_Attached: {file.get('name') or 'file'} ({file_kind(file)}, {human_size(file.get('size'))})_")
        md_lines.append("")
        md_lines.append("---")
        md_lines.append("")

    filename = f"{_safe_filename(thread_name)}_export.md"
    content = "\n".join(md_lines)

    return Response(
        content=content,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
