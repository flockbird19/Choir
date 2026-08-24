"""
LLM orchestration module.

Handles:
- Assembling prompt context (shared thread as system context for private threads)
- Streaming from Anthropic, OpenAI, Google Gemini (OpenAI-compat), and Groq (OpenAI-compat)
- Persisting the final assistant message to Supabase after the stream finishes
- Yielding SSE-formatted strings for FastAPI's StreamingResponse
"""

import json
from typing import Any, Generator, cast

from backend.db import get_db
from backend.keys import get_api_key

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
        "default_model": "gemini-2.0-flash",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
    },
}

ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5"

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


def _fetch_messages(thread_id: str) -> list[dict[str, Any]]:
    db = get_db()
    resp = (
        db.table("messages")
        .select("*")
        .eq("thread_id", thread_id)
        .order("created_at")
        .execute()
    )
    return cast(list[dict[str, Any]], resp.data)


def _save_assistant_message(
    thread_id: str, content: str, provider: str, model: str
) -> None:
    db = get_db()
    db.table("messages").insert(
        {
            "thread_id": thread_id,
            "sender_type": "assistant",
            "content": content,
            "model_provider": provider,
            "model_name": model,
        }
    ).execute()


# ---------------------------------------------------------------------------
# Context assembly
# ---------------------------------------------------------------------------


def _to_chat_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Convert DB message rows into the OpenAI-style [{role, content}] format."""
    result = []
    for msg in messages:
        role = "assistant" if msg["sender_type"] == "assistant" else "user"
        content = msg["content"]
        if msg.get("shared_by"):
            content = f"[Shared from private exploration]\n{content}"
        result.append({"role": role, "content": content})
    return result


def _format_shared_as_system_context(messages: list[dict[str, Any]]) -> str:
    """Render the shared thread as a plain-text context block for the system prompt."""
    if not messages:
        return "(No shared team context yet.)"
    lines = ["=== SHARED TEAM THREAD (background context — read-only) ==="]
    for msg in messages:
        label = "AI" if msg["sender_type"] == "assistant" else "Team member"
        lines.append(f"{label}: {msg['content']}")
    lines.append("=== END OF SHARED CONTEXT ===")
    return "\n".join(lines)


def _resolve_provider_and_model(
    thread: dict[str, Any], user_id: str
) -> tuple[str, str] | None:
    """
    Determine which provider + model to use for this thread.
    For private threads: use thread.model_provider / thread.model_name if set,
    otherwise fall back to the first provider for which the user has a key.
    Returns (provider, model) or None if no key is available.
    """
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
            default_model = (
                ANTHROPIC_DEFAULT_MODEL
                if provider == "anthropic"
                else OPENAI_COMPAT_PROVIDERS[provider]["default_model"]
            )
            model = thread_model if (thread_provider == provider and thread_model) else default_model
            return provider, model

    return None


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


# ---------------------------------------------------------------------------
# Main streaming function
# ---------------------------------------------------------------------------


def stream_ai_response(
    thread_id: str,
    user_id: str,
) -> Generator[str, None, None]:
    """
    Core generator: assembles context, calls the LLM, streams SSE chunks to the
    caller, and persists the completed message to Supabase when done.

    SSE event shapes:
      { "text": "..." }        — incremental token
      { "error": "..." }       — terminal error
      { "done": true }         — stream finished successfully
    """
    # ── Fetch thread ──────────────────────────────────────────────────────────
    thread = _fetch_thread(thread_id)
    if not thread:
        yield _sse({"error": "Thread not found."})
        return

    # ── Resolve provider / model ──────────────────────────────────────────────
    resolved = _resolve_provider_and_model(thread, user_id)
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

    provider, model = resolved
    api_key = get_api_key(user_id, provider)
    if not api_key:
        yield _sse({"error": f"Could not retrieve API key for {provider}."})
        return

    # ── Assemble context ──────────────────────────────────────────────────────
    if thread["type"] == "private":
        # Find the shared thread for this project
        db = get_db()
        shared_resp = (
            db.table("threads")
            .select("id")
            .eq("project_id", thread["project_id"])
            .eq("type", "shared")
            .execute()
        )
        shared_rows = cast(list[dict[str, Any]], shared_resp.data)
        shared_msgs: list[dict[str, Any]] = []
        if shared_rows:
            shared_msgs = _fetch_messages(shared_rows[0]["id"])

        system_prompt = (
            "You are a helpful AI assistant in Choir, a collaborative team AI platform. "
            "You are inside a user's private thread — your responses are visible only to them.\n\n"
            "Below is the shared team thread for background context. "
            "Use it to stay aligned with the team's goals, but keep the private conversation focused.\n\n"
            + _format_shared_as_system_context(shared_msgs)
        )
        chat_messages = _to_chat_messages(_fetch_messages(thread_id))

    else:
        # Shared thread — use the project owner's key if possible
        project = _fetch_project(thread["project_id"])
        if project:
            proj_provider = project.get("shared_model_provider") or "anthropic"
            proj_model = project.get("shared_model_name") or ANTHROPIC_DEFAULT_MODEL
            owner_id = project.get("created_by")
            if owner_id:
                owner_key = get_api_key(owner_id, proj_provider)
                if owner_key:
                    provider, model, api_key = proj_provider, proj_model, owner_key

        system_prompt = (
            "You are a helpful AI assistant in Choir. "
            "You are in the shared team thread — your responses are visible to all team members. "
            "Be clear, collaborative, and concise."
        )
        chat_messages = _to_chat_messages(_fetch_messages(thread_id))

    # ── Stream from LLM ───────────────────────────────────────────────────────
    full_response = ""

    try:
        if provider == "anthropic":
            import anthropic  # type: ignore

            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model=model,
                max_tokens=4096,
                system=system_prompt,
                messages=chat_messages,  # type: ignore[arg-type]
            ) as stream:
                for text in stream.text_stream:
                    full_response += text
                    yield _sse({"text": text})

        else:
            import openai as openai_module  # type: ignore

            config = OPENAI_COMPAT_PROVIDERS[provider]
            base_url: str | None = config["base_url"] or None
            client = openai_module.OpenAI(api_key=api_key, base_url=base_url)

            all_messages: list[dict[str, str]] = [
                {"role": "system", "content": system_prompt},
                *chat_messages,
            ]

            with client.chat.completions.create(  # type: ignore[call-overload]
                model=model,
                messages=all_messages,  # type: ignore[arg-type]
                stream=True,
            ) as stream:
                for chunk in stream:
                    delta = chunk.choices[0].delta.content  # type: ignore[union-attr]
                    if delta:
                        full_response += delta
                        yield _sse({"text": delta})

    except Exception as exc:
        err = str(exc)
        if "429" in err or "rate_limit" in err.lower() or "quota" in err.lower():
            yield _sse(
                {
                    "error": (
                        "Rate limit reached. Please check your API key usage limits "
                        "or try again later."
                    )
                }
            )
        else:
            yield _sse({"error": f"AI error: {err}"})
        return

    # ── Persist final message ─────────────────────────────────────────────────
    if full_response.strip():
        _save_assistant_message(thread_id, full_response, provider, model)

    yield _sse({"done": True})
