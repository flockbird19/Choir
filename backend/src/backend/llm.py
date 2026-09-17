"""
LLM orchestration module.

Handles:
- Assembling prompt context (shared thread as system context for private threads)
- Streaming from Anthropic, OpenAI, Google Gemini (OpenAI-compat), and Groq (OpenAI-compat)
- Persisting the final assistant message to Supabase after the stream finishes
- Yielding SSE-formatted strings for FastAPI's StreamingResponse
"""

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Generator, cast

from backend import shared_keys
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
# Team roster — who is on the team, so the AI knows who said what
# ---------------------------------------------------------------------------

_NAME_CACHE_TTL_SECONDS = 300
_name_cache: dict[str, tuple[str, float]] = {}

FORMER_MEMBER = "Former member"


def _display_name(user: Any) -> str:
    """Same order as the frontend's getDisplayName: saved name, Google name, email prefix."""
    metadata = getattr(user, "user_metadata", None) or {}
    for key in ("full_name", "name"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    email = getattr(user, "email", None) or ""
    return email.split("@")[0] or "Teammate"


def _fetch_user_name(user_id: str) -> str | None:
    cached = _name_cache.get(user_id)
    if cached and time.monotonic() - cached[1] < _NAME_CACHE_TTL_SECONDS:
        return cached[0]
    try:
        user = get_db().auth.admin.get_user_by_id(user_id).user
    except Exception:
        return None
    if not user:
        return None
    name = _display_name(user)
    _name_cache[user_id] = (name, time.monotonic())
    return name


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
    user_ids = [row["user_id"] for row in rows]
    with ThreadPoolExecutor(max_workers=8) as pool:
        names = list(pool.map(_fetch_user_name, user_ids))
    return [
        {"user_id": row["user_id"], "name": name or FORMER_MEMBER, "role": row.get("role") or "member"}
        for row, name in zip(rows, names)
    ]


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


def _to_chat_messages(
    messages: list[dict[str, Any]], names: dict[str, str] | None = None
) -> list[dict[str, str]]:
    """
    Convert DB message rows into the OpenAI-style [{role, content}] format.
    With `names`, each person's message is prefixed with who wrote it, since
    several people share the "user" role in a team thread.
    """
    result = []
    for msg in messages:
        role = "assistant" if msg["sender_type"] == "assistant" else "user"
        content = msg["content"]
        if role == "user" and names is not None:
            label = sender_label(msg, names)
            if msg.get("shared_by"):
                content = f"[{label}, shared from their private thread]\n{content}"
            else:
                content = f"[{label}]: {content}"
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
    thread: dict[str, Any], shared_msgs: list[dict[str, Any]], names: dict[str, str]
) -> str:
    """
    D2 "Discuss privately": a private thread started from a shared message is about that
    message. Only messages from this project's shared thread are used, so nothing else leaks in.
    """
    forked_id = thread.get("forked_from_message_id")
    focus = next((m for m in shared_msgs if forked_id and m.get("id") == forked_id), None)
    if not focus:
        return ""
    return (
        "\nFOCUS: The user started this private thread to discuss one message from the shared thread, "
        f"written by {sender_label(focus, names)}:\n"
        f"\"\"\"\n{focus['content']}\n\"\"\"\n"
        "Treat that message as the focus of this conversation.\n"
    )


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


def _stream_text(
    provider: str, model: str, api_key: str, system_prompt: str, chat_messages: list[dict[str, str]]
) -> Generator[str, None, None]:
    """Yield text chunks from one provider call."""
    if provider == "anthropic":
        import anthropic  # type: ignore

        client = anthropic.Anthropic(api_key=api_key)
        with client.messages.stream(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            messages=chat_messages,  # type: ignore[arg-type]
        ) as stream:
            yield from stream.text_stream
        return

    import openai as openai_module  # type: ignore

    config = OPENAI_COMPAT_PROVIDERS[provider]
    base_url: str | None = config["base_url"] or None
    client = openai_module.OpenAI(api_key=api_key, base_url=base_url)
    all_messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}, *chat_messages]
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
) -> Generator[str, None, None]:
    """
    Core generator: assembles context, calls the LLM, streams SSE chunks to the
    caller, and persists the completed message to Supabase when done.

    SSE event shapes:
      { "text": "..." }        — incremental token
      { "notice": "...", "model": "..." } — switched to a lent key after a rate limit
      { "error": "..." }       — terminal error
      { "done": true }         — stream finished successfully
    """
    # ── Fetch thread ──────────────────────────────────────────────────────────
    thread = _fetch_thread(thread_id)
    if not thread:
        yield _sse({"error": "Thread not found."})
        return

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

        provider, model = resolved
        caller_key = get_api_key(user_id, provider)
        if not caller_key:
            yield _sse({"error": f"Could not retrieve API key for {provider}."})
            return
        api_key = caller_key
        key_owner_id = user_id

    # ── Assemble context ──────────────────────────────────────────────────────
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
    team_context = (
        _format_roster(roster, user_id)
        + "\nThis is everyone on the team, including people who haven't posted yet. "
        "Messages from people are prefixed with the sender's name in square brackets; "
        "do not add such a prefix to your own replies."
    )

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
        shared_msgs: list[dict[str, Any]] = []
        if shared_rows:
            shared_msgs = _fetch_messages(shared_rows[0]["id"])

        system_prompt = (
            f"You are Choir, an AI in a private scratchpad for {workspace_context}. You are currently talking to: {user_name_ctx}. User role: {role_ctx}.\n"
            + team_context + "\n"
            "ROLE: Brainstorming partner. Help explore, stress-test, and refine ideas before they are shared with the team.\n"
            "STYLE: Exploratory, direct, creative, yet concise. Do NOT use emojis. Provide enough detail to be genuinely helpful, but avoid exhaustively long or overly verbose responses.\n"
            "CONTEXT: The team's shared thread is below for alignment. Only answer the user's immediate private questions.\n"
            + _fork_focus_context(thread, shared_msgs, names)
            + "\n"
            + _format_shared_as_system_context(shared_msgs, names, user_id)
        )
        # Only the owner writes in a private thread, so no sender labels are needed.
        chat_messages = _to_chat_messages(_fetch_messages(thread_id))

    else:
        system_prompt = (
            f"You are Choir, the central AI for {workspace_context}. You are currently talking to: {user_name_ctx}. User role: {role_ctx}.\n"
            + team_context + "\n"
            "ROLE: Synthesizer, facilitator, and collective intelligence for the team.\n"
            "STYLE: Objective, concise, collaborative. Do NOT use emojis. Provide enough detail to be genuinely helpful, but avoid exhaustively long or overly verbose responses. Do not hallucinate private context."
        )
        chat_messages = _to_chat_messages(_fetch_messages(thread_id), names)

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
        while True:
            try:
                for text in _stream_text(provider, model, api_key, system_prompt, chat_messages):
                    full_response += text
                    yield _sse({"text": text})
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
                provider = candidate.provider
                model = candidate.model or _default_model(provider)
                key_owner_id = candidate.user_id
                lender = _fetch_user_name(candidate.user_id) or "a teammate"
                yield _sse({"notice": f"Using {lender}'s key", "model": model})
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

    project = _fetch_project(thread["project_id"])
    roster = _fetch_team_roster(project["team_id"]) if project and project.get("team_id") else []
    names = {member["user_id"]: member["name"] for member in roster}
    context_block = _format_shared_as_system_context(new_messages, names, user_id)
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
