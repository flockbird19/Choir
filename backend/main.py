from typing import Any, cast

from fastapi import Depends, FastAPI, HTTPException
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


@app.post("/api/chat")
def chat(body: ChatRequest, user_id: str = Depends(get_current_user)):
    """
    Trigger an AI response for the given thread.

    - Verifies the user has access to the thread.
    - Assembles context (shared thread injected as system prompt for private threads).
    - Streams the LLM response as Server-Sent Events (SSE).
    - Persists the final response to Supabase once streaming is complete.
    """
    if not verify_thread_access(user_id, body.thread_id):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this thread.",
        )

    return StreamingResponse(
        stream_ai_response(body.thread_id, user_id),
        media_type="text/event-stream",
        headers={
            # Prevent buffering in proxies / Next.js dev server
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
