"""
Feature D stage 2: the MCP server a connected coding agent (Claude Code, Cursor, Codex...) talks to.

Sign-in is Supabase's OAuth 2.1 server: the tool registers itself, the person clicks Allow on Choir's
/oauth/consent page (which records the grant: which project), and the tool gets the person's token
with a client_id claim. Every request is checked here (signature, issuer, expiry, client_id, an active
grant, still on the team); the tools in agent_tools.py then act for that person in that project only.
"""

import asyncio
import os
from urllib.parse import urlparse

import jwt
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

from backend import agent_tools as tools
from backend import auth

# 127.0.0.1, not localhost: coding tools (Node) try "localhost" as IPv6 (::1) first, and the dev server
# listens on IPv4 only, so a localhost URL is refused. Production sets MCP_RESOURCE_URL.
RESOURCE_URL = os.getenv("MCP_RESOURCE_URL", "http://127.0.0.1:8000/mcp").rstrip("/")


class GrantVerifier:
    """Accepts only agents' OAuth tokens that belong to an active Choir connection."""

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            key = auth._jwks_client().get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token, key.key, algorithms=auth.ASYMMETRIC_ALGORITHMS, audience=auth.AUDIENCE,
                issuer=auth._issuer(), options={"require": ["exp", "sub", "client_id"]},
            )  # fmt: skip
        except jwt.PyJWTError:
            return None
        grant = await asyncio.to_thread(tools.find_grant, claims["sub"], str(claims["client_id"]))
        if not grant:
            return None
        return AccessToken(
            token=token, client_id=str(claims["client_id"]), scopes=str(claims.get("scope") or "").split(),
            expires_at=claims.get("exp"), subject=claims["sub"], claims={**claims, "choir_grant": grant},
        )  # fmt: skip


INSTRUCTIONS = """\
You are connected to a Choir project for one person (your person). Choir is where their team keeps its shared
context: Team Space, pinned Decisions, project memory and a task list that is the only record of who is doing what.

- Start with get_project_brief. Before touching an area, check the task list: if someone else has claimed it,
  don't work on it.
- Claim a task only when your person asks you to (claim_task), then start_task, which opens a private thread for
  that task between you and your person. Nobody else sees it.
- Post an update there (post_update) when something meaningful happens or you need an answer, not every step.
- Before continuing work, read the task thread (read_task_thread) for your person's replies or a send-back note.
- When you think the task is finished, call request_review with what you did and a suggested result. Only your
  person can mark a task done; never say a task is done any other way.
- You can't post in Team Space, read other private threads, or add, edit or delete tasks. If you find new work,
  say so in the task thread and your person will add it."""

_host = urlparse(RESOURCE_URL).netloc
mcp_server = MCPServer(
    name="choir",
    instructions=INSTRUCTIONS,
    token_verifier=GrantVerifier(),
    # Supabase tokens carry aud "authenticated", never this URL; GrantVerifier checks audience and grant itself.
    auth=AuthSettings(issuer_url=auth._issuer(), resource_server_url=RESOURCE_URL, validate_token_resource=False),
)
# DNS-rebinding protection (on by default for localhost) also has to know the deployed host name.
TRANSPORT_SECURITY = TransportSecuritySettings(
    allowed_hosts=[_host, "localhost:*", "127.0.0.1:*"],
    allowed_origins=[f"{urlparse(RESOURCE_URL).scheme}://{_host}", "http://localhost:*", "http://127.0.0.1:*"],
)


def _grant() -> tools.Grant:
    token = get_access_token()
    grant = (token.claims or {}).get("choir_grant") if token else None
    if not isinstance(grant, tools.Grant):
        raise tools.AgentError("This connection was removed in Choir. Connect again from Settings → Connect your AI.")
    tools.check_rate(grant)
    return grant


async def _run(fn, *args):
    """Tools are plain database work: run them off the event loop; refusals become readable errors."""
    grant = _grant()
    try:
        return await asyncio.to_thread(fn, grant, *args)
    except tools.AgentError as exc:
        raise ValueError(str(exc)) from None


@mcp_server.tool()
async def get_project_brief() -> str:
    """Start here: the project, team, project memory, pinned Decisions, the task list (who has what) and recent Team Space."""
    return await _run(tools.project_brief)


@mcp_server.tool()
async def list_tasks(which: str = "all") -> str:
    """The task list with each task's short id, status and who has it. which: "open", "mine" or "all"."""
    return await _run(tools.list_tasks, which)


@mcp_server.tool()
async def get_task(task_id: str) -> str:
    """One task: details, result, the Team Space messages and Decisions it came from, and its review state."""
    return await _run(tools.get_task, task_id)


@mcp_server.tool()
async def search_team_space(query: str) -> str:
    """Team Space messages containing the words, newest first (up to 20)."""
    return await _run(tools.search_team_space, query)


@mcp_server.tool()
async def claim_task(task_id: str) -> str:
    """Claim an open task for your person. Only when they ask you to. Exactly one claim wins."""
    return await _run(tools.claim_task, task_id)


@mcp_server.tool()
async def start_task(task_id: str) -> str:
    """Start your person's claimed task: opens (or reopens) its private thread with them and returns the task and thread."""
    return await _run(tools.start_task, task_id)


@mcp_server.tool()
async def read_task_thread(task_id: str, since: str | None = None) -> str:
    """Messages in the task's private thread (yours and your person's), oldest first. since: only newer than this time."""
    return await _run(tools.read_task_thread, task_id, since)


@mcp_server.tool()
async def post_update(task_id: str, message: str) -> str:
    """Post a short update or question in the task's private thread (up to 2,000 characters). Only your person sees it."""
    return await _run(tools.post_update, task_id, message)


@mcp_server.tool()
async def request_review(task_id: str, summary: str, suggested_result: str, links: list[str] | None = None) -> str:
    """Ask your person to review: what you did, a suggested result for the task (up to 1,000 characters), and links (PR, test run)."""
    return await _run(tools.request_review, task_id, summary, suggested_result, links)


@mcp_server.tool()
async def release_task(task_id: str, reason: str) -> str:
    """Give your person's task back to the team (open again), saying why in the task thread."""
    return await _run(tools.release_task, task_id, reason)


@mcp_server.prompt(name="next")
def next_task() -> str:
    """Find a task to work on."""
    return (
        "Call get_project_brief, then show me the open tasks and suggest one that fits what I'm working on. "
        "Claim it only after I say yes."
    )


@mcp_server.prompt()
def task(task_id: str) -> str:
    """Work on a Choir task."""
    return (
        f"Work on Choir task {task_id}: call start_task, read its sources and its thread (if it was sent back, start "
        "from my note), do the work, post short updates as you go, and call request_review when you think it's done."
    )


@mcp_server.prompt()
def review() -> str:
    """Pick up where you left off."""
    return "List my tasks, read each one's task thread for my replies or send-back notes, and continue where you left off."


@mcp_server.prompt()
def status() -> str:
    """Who's doing what."""
    return "Call list_tasks and summarise who is doing what and what is still open."
