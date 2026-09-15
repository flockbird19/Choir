"""
LLM orchestration module.

Handles:
- Assembling prompt context (shared thread as system context for private threads)
- Streaming from Anthropic, OpenAI, Google Gemini (OpenAI-compat), and Groq (OpenAI-compat)
- Persisting the final assistant message to Supabase after the stream finishes
- Yielding SSE-formatted strings for FastAPI's StreamingResponse
"""

import json
from datetime import datetime, timezone
from typing import Any, Generator, cast

from backend.db import get_db
from backend.keys import get_api_key


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


def _fetch_messages_since(thread_id: str, since: str | None) -> list[dict[str, Any]]:
    """
    Messages newer than `since`, oldest first. If `since` is None (the user has
    never used Catch Me Up on this thread), falls back to the most recent 30
    messages instead of the full history, to keep the digest prompt bounded.
    """
    db = get_db()
    if since:
        resp = (
            db.table("messages")
            .select("*")
            .eq("thread_id", thread_id)
            .gt("created_at", since)
            .order("created_at")
            .execute()
        )
        return cast(list[dict[str, Any]], resp.data)

    resp = (
        db.table("messages")
        .select("*")
        .eq("thread_id", thread_id)
        .order("created_at", desc=True)
        .limit(30)
        .execute()
    )
    return list(reversed(cast(list[dict[str, Any]], resp.data)))


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
    thread_id: str, content: str, provider: str, model: str
) -> str | None:
    db = get_db()
    resp = db.table("messages").insert(
        {
            "thread_id": thread_id,
            "sender_type": "assistant",
            "content": content,
            "model_provider": provider,
            "model_name": model,
        }
    ).execute()
    data = cast(list[dict[str, Any]], resp.data)
    return data[0]["id"] if data else None


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


def _format_shared_as_system_context(messages: list[dict[str, Any]], current_user_id: str, current_user_name: str) -> str:
    """Render the shared thread as a plain-text context block for the system prompt."""
    if not messages:
        return "[No shared team context yet]"
    lines = ["--- SHARED THREAD (Read-Only) ---"]
    for msg in messages:
        if msg["sender_type"] == "assistant":
            label = "AI"
        else:
            if msg.get("sender_id") == current_user_id:
                label = current_user_name
            else:
                label = "Team Member"
        lines.append(f"{label}: {msg['content']}")
    lines.append("--- END SHARED ---")
    return "\n".join(lines)


def _resolve_provider_and_model(
    thread: dict[str, Any], user_id: str, override_provider: str | None = None, override_model: str | None = None
) -> tuple[str, str] | None:
    """
    Determine which provider + model to use for this thread.
    If overrides are provided, uses them (fails if no key).
    For private threads: use thread.model_provider / thread.model_name if set,
    otherwise fall back to the first provider for which the user has a key.
    Returns (provider, model) or None if no key is available.
    """
    if override_provider and override_model:
        key = get_api_key(user_id, override_provider)
        if key:
            return override_provider, override_model
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
    override_provider: str | None = None,
    override_model: str | None = None,
    user_name: str | None = None,
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

    provider, model = resolved
    api_key = get_api_key(user_id, provider)
    if not api_key:
        yield _sse({"error": f"Could not retrieve API key for {provider}."})
        return

    # ── Assemble context ──────────────────────────────────────────────────────
    project = _fetch_project(thread["project_id"])
    role = "member"
    if project:
        db = get_db()
        role_resp = (
            db.table("team_members")
            .select("role")
            .eq("team_id", project["team_id"])
            .eq("user_id", user_id)
            .execute()
        )
        role_data = cast(list[dict[str, Any]], role_resp.data)
        if role_data:
            role = role_data[0].get("role", "member")

    role_ctx = "a Team Owner" if role == "owner" else "a Team Member"
    user_name_ctx = user_name or "the User"

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
            f"You are Choir, an AI in a private scratchpad for {workspace_context}. You are currently talking to: {user_name_ctx}. User role: {role_ctx}.\n"
            "ROLE: Brainstorming partner. Help explore, stress-test, and refine ideas before they are shared with the team.\n"
            "STYLE: Exploratory, direct, creative, yet concise. Do NOT use emojis. Provide enough detail to be genuinely helpful, but avoid exhaustively long or overly verbose responses.\n"
            "CONTEXT: The team's shared thread is below for alignment. Only answer the user's immediate private questions.\n\n"
            + _format_shared_as_system_context(shared_msgs, user_id, user_name_ctx)
        )
        chat_messages = _to_chat_messages(_fetch_messages(thread_id))

    else:
        # Shared thread — use the project owner's key if possible
        if project:
            proj_provider = project.get("shared_model_provider") or "anthropic"
            proj_model = project.get("shared_model_name") or ANTHROPIC_DEFAULT_MODEL
            owner_id = project.get("created_by")
            if owner_id:
                owner_key = get_api_key(owner_id, proj_provider)
                if owner_key:
                    provider, model, api_key = proj_provider, proj_model, owner_key

        system_prompt = (
            f"You are Choir, the central AI for {workspace_context}. You are currently talking to: {user_name_ctx}. User role: {role_ctx}.\n"
            "ROLE: Synthesizer, facilitator, and collective intelligence for the team.\n"
            "STYLE: Objective, concise, collaborative. Do NOT use emojis. Provide enough detail to be genuinely helpful, but avoid exhaustively long or overly verbose responses. Do not hallucinate private context."
        )
        chat_messages = _to_chat_messages(_fetch_messages(thread_id))

    # ── Stream from LLM ───────────────────────────────────────────────────────
    full_response = ""
    msg_id: str | None = None
    stream_failed = False

    # The `finally` below persists whatever text was generated even if this
    # generator is torn down early — e.g. the client disconnects mid-stream, in
    # which case Python raises GeneratorExit at the next `yield`. Previously
    # persistence only happened after the loop finished normally, so a dropped
    # connection silently discarded an otherwise fully-generated response. The
    # `finally` block must not attempt to yield (that raises RuntimeError while
    # a GeneratorExit is propagating), so `done` is only ever yielded after it.
    try:
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
            stream_failed = True
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
    finally:
        # Persist whatever was generated so far — on a clean finish this is the
        # full response; on a disconnect or mid-stream provider error it's a
        # partial one, which still beats losing it outright.
        if full_response.strip():
            msg_id = _save_assistant_message(thread_id, full_response, provider, model)

    if not stream_failed:
        yield _sse({"done": True, "message_id": msg_id})


# ---------------------------------------------------------------------------
# "Catch Me Up" digest — one-shot, non-streaming summary of new messages
# ---------------------------------------------------------------------------


DIGEST_SYSTEM_PROMPT = (
    "You are Choir's digest assistant. Summarize what happened in a team's shared AI chat "
    "thread since the user last checked, so they can catch up quickly without re-reading "
    "everything.\n"
    "STYLE: Concise. Do NOT use emojis. Structure the summary as short bullet points under "
    "these headings when relevant: Decisions, Updates, Open questions. Omit a heading if there "
    "is nothing for it. Do not restate the raw messages verbatim — synthesize."
)


def generate_digest(thread_id: str, user_id: str) -> dict[str, Any]:
    """
    Summarizes shared-thread messages the caller hasn't seen yet, using their own
    BYOK key (never the shared thread owner's — this is a personal, read-only
    convenience action, not part of the canonical conversation).

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

    provider, model = resolved
    api_key = get_api_key(user_id, provider)
    if not api_key:
        raise NoApiKeyError(f"Could not retrieve API key for {provider}.")

    last_seen = _fetch_thread_read(thread_id, user_id)
    new_messages = _fetch_messages_since(thread_id, last_seen)
    now_iso = datetime.now(timezone.utc).isoformat()

    if not new_messages:
        _upsert_thread_read(thread_id, user_id, now_iso)
        return {
            "summary": "You're all caught up — no new messages since your last check.",
            "message_count": 0,
        }

    context_block = _format_shared_as_system_context(new_messages, user_id, "You")
    user_prompt = f"Here are the new messages since your last check:\n\n{context_block}"

    try:
        if provider == "anthropic":
            import anthropic  # type: ignore

            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=model,
                max_tokens=512,
                system=DIGEST_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )
            summary = response.content[0].text if response.content else ""  # type: ignore[union-attr]

        else:
            import openai as openai_module  # type: ignore

            config = OPENAI_COMPAT_PROVIDERS[provider]
            base_url: str | None = config["base_url"] or None
            client = openai_module.OpenAI(api_key=api_key, base_url=base_url)

            response = client.chat.completions.create(  # type: ignore[call-overload]
                model=model,
                messages=[
                    {"role": "system", "content": DIGEST_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            summary = response.choices[0].message.content or ""

    except Exception as exc:
        err = str(exc)
        if "429" in err or "rate_limit" in err.lower() or "quota" in err.lower():
            raise RuntimeError(
                "Rate limit reached. Please check your API key usage limits or try again later."
            ) from exc
        raise RuntimeError(f"AI error: {err}") from exc

    _upsert_thread_read(thread_id, user_id, now_iso)
    return {"summary": summary.strip(), "message_count": len(new_messages)}
