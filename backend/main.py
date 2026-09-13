from datetime import datetime
import json
import re
from typing import Any, cast

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import get_db, verify_thread_access
from backend.keys import (
    delete_api_key,
    list_saved_providers,
    store_api_key,
)
from backend.llm import stream_ai_response

app = FastAPI(title="Choir AI Backend")

# Allow Next.js frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
# Health check
# ──────────────────────────────────────────────────────────────────────────────


@app.get("/")
def read_root():
    return {"status": "ok", "message": "Choir Python Backend is running!"}


@app.get("/api/me")
def get_my_info(user_id: str = Depends(get_current_user)):
    """
    Test endpoint to verify authentication works.
    Returns the user's ID and fetches their teams from the database
    bypassing RLS (since we are using the service role key).
    """
    db = get_db()
    response = db.table("team_members").select("team_id").eq("user_id", user_id).execute()
    data = cast(list[dict[str, Any]], response.data)
    team_ids = [row["team_id"] for row in data] if data else []

    return {
        "user_id": user_id,
        "team_ids": team_ids,
        "message": "Authentication successful!",
    }


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
# AI Chat — streaming endpoint
# ──────────────────────────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    thread_id: str
    model_provider: str | None = None
    model_name: str | None = None
    user_name: str | None = None


import time
from collections import defaultdict

# Simple in-memory rate limiting (per user, per minute)
AI_RATE_LIMITS = defaultdict(list)
MAX_REQUESTS_PER_MINUTE = 15

@app.post("/api/chat")
def chat(body: ChatRequest, user_id: str = Depends(get_current_user)):
    """
    Trigger an AI response for the given thread.

    - Verifies the user has access to the thread.
    - Assembles context (shared thread injected as system prompt for private threads).
    - Streams the LLM response as Server-Sent Events (SSE).
    - Persists the final response to Supabase once streaming is complete.
    """

    # ── Rate Limiting ──
    now = time.time()
    user_requests = AI_RATE_LIMITS[user_id]
    user_requests = [t for t in user_requests if now - t < 60]
    if len(user_requests) >= MAX_REQUESTS_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. You can only make {MAX_REQUESTS_PER_MINUTE} requests per minute.",
        )
    user_requests.append(now)
    AI_RATE_LIMITS[user_id] = user_requests

    if not verify_thread_access(user_id, body.thread_id):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this thread.",
        )

    return StreamingResponse(
        stream_ai_response(body.thread_id, user_id, body.model_provider, body.model_name, body.user_name),
        media_type="text/event-stream",
        headers={
            # Prevent buffering in proxies / Next.js dev server
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ──────────────────────────────────────────────────────────────────────────────
# Export — separate from /api/chat to avoid route shadowing
# ──────────────────────────────────────────────────────────────────────────────


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

    if format == "json":
        export_data = {
            "thread": thread,
            "messages": messages,
            "exported_at": datetime.utcnow().isoformat()
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
    md_lines.append(f"**Exported:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
    md_lines.append(f"**Type:** {thread.get('type', 'Unknown').capitalize()}")
    md_lines.append("")
    md_lines.append("---")
    md_lines.append("")

    for msg in messages:
        sender = "User" if msg["sender_type"] == "user" else "AI"
        model = msg.get("model_name")
        if model and sender == "AI":
            sender += f" ({model})"

        md_lines.append(f"**{sender}:**")
        md_lines.append("")
        md_lines.append(msg["content"])
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
