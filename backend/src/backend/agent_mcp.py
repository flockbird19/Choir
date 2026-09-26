"""
M1 spike: the MCP server a connected coding agent (Claude Code, Cursor, Codex...)
actually talks to.

Auth is our own hashed token (see agents.resolve_agent_token), not MCP's built-in
OAuth machinery -- a pre-shared token is all a single-user CLI/IDE tool needs, and
the SDK's `Context.headers` is documented as client-supplied input, never an
identity assertion, which is exactly why every tool below verifies it through
that function instead of trusting it.
"""

from mcp.server.mcpserver import Context, MCPServer

from backend import agents

mcp_server = MCPServer(
    name="choir",
    instructions=(
        "Tools for a coding agent connected to a Choir project. Call read_team_space at the "
        "start of a session to learn what the team already decided. Call update_status often "
        "with a short present-tense phrase (e.g. 'refactoring auth') -- it only updates your "
        "sidebar presence, never posts to the shared channel. Call post_message only when "
        "you're blocked and need a teammate's answer, when a task is done, or when replying to "
        "something a teammate said to you -- not for routine progress narration."
    ),
)


def _agent_from(ctx: Context) -> agents.AgentContext:
    token = (ctx.headers or {}).get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise ValueError("Missing bearer token.")
    agent = agents.resolve_agent_token(token)
    if not agent:
        raise ValueError("Invalid or revoked agent token.")
    return agent


@mcp_server.tool()
async def read_team_space(ctx: Context) -> str:
    """Read the connected project's Team Space: current Decisions and recent messages."""
    agent = _agent_from(ctx)
    return agents.read_team_space(agent.project_id)


@mcp_server.tool()
async def update_status(status: str, ctx: Context) -> str:
    """Update your sidebar status (e.g. "refactoring auth"). Never posts a message."""
    agent = _agent_from(ctx)
    agents.set_agent_status(agent.agent_user_id, status)
    return "Status updated."


@mcp_server.tool()
async def post_message(content: str, ctx: Context) -> str:
    """Post to Team Space -- only for being blocked, being done, or a reply. Not routine narration."""
    agent = _agent_from(ctx)
    try:
        agents.post_agent_message(agent.agent_user_id, agent.project_id, content)
    except agents.AgentError as exc:
        return f"Could not post: {exc}"
    return "Posted to Team Space."
