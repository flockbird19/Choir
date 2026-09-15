from datetime import datetime, timedelta, timezone
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
from backend.llm import NoApiKeyError, generate_digest, stream_ai_response

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


MAX_REQUESTS_PER_MINUTE = 15


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

    # Opportunistic cleanup so the log table doesn't grow unbounded — cheap at
    # this scale and avoids needing a separate cron job.
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
# "Catch Me Up" — one-shot AI digest of new shared-thread messages
# ──────────────────────────────────────────────────────────────────────────────


@app.post("/api/digest/{thread_id}")
def get_digest(thread_id: str, user_id: str = Depends(get_current_user)):
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
        return generate_digest(thread_id, user_id)
    except NoApiKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


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
