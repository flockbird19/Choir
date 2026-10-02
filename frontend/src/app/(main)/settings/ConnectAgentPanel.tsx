"use client";

import { useState } from "react";
import { Bot, Copy, ExternalLink } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { formatRelative } from "@/utils/format";
import { disconnectAgent } from "@/app/(main)/agents/actions";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const MCP_URL = `${BACKEND_URL.replace(/\/$/, "")}/mcp`;

export type Connection = { id: string; tool: string; project: string; lastUsed: string | null };

// Install links: each tool installs the server, then opens Choir's Allow page on first use.
const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=choir&config=${encodeURIComponent(btoa(JSON.stringify({ url: MCP_URL })))}`;
const VSCODE_LINK = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "choir", type: "http", url: MCP_URL }))}`;

const TOOLS: { name: string; how: string; link?: string; copy?: string; copyLabel?: string }[] = [
  { name: "Cursor", how: "Opens Cursor, which asks to install Choir.", link: CURSOR_LINK },
  { name: "VS Code", how: "Opens VS Code, which asks to install Choir.", link: VSCODE_LINK },
  {
    name: "Claude Code",
    how: "Paste this into Claude Code. It adds Choir; then run /mcp and choose Authenticate.",
    copy: `Add an MCP server called choir using HTTP transport at ${MCP_URL}`,
  },
  {
    name: "Codex",
    how: "Paste this into Codex. It adds Choir and asks you to sign in.",
    copy: `Add the Choir MCP server (streamable HTTP) at ${MCP_URL}, then sign in with: codex mcp login choir`,
  },
  {
    name: "Claude Desktop or claude.ai",
    how: "Settings → Connectors → Add custom connector, then paste the link.",
    copy: MCP_URL,
    copyLabel: "Copy link",
  },
];

/**
 * Feature D stage 2: connect a coding tool with no commands. The tool signs in through Choir's
 * Allow page (you pick the project there); it then reads the team's context and works on the tasks
 * you give it. Below: what's connected, with Disconnect.
 */
export function ConnectAgentPanel({ connections }: { connections: Connection[] }) {
  const toast = useToast();
  const [removing, setRemoving] = useState<string | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it yourself.");
    }
  };

  const remove = async (id: string) => {
    setRemoving(id);
    const result = await disconnectAgent(id);
    setRemoving(null);
    if (result.error) toast.error(result.error);
    else toast.success("Disconnected");
  };

  return (
    <div>
      <h2 className="mb-3 px-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">Connect your AI</h2>
      <div className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-hover">
            <Bot size={16} className="text-fg-muted" aria-hidden="true" />
          </div>
          <p className="text-sm leading-relaxed text-fg-muted">
            Let Cursor, Claude Code or Codex read your team&rsquo;s context and work on tasks you give it. It talks to
            you in a private thread for each task, and only you mark a task done. It never posts in Team Space or reads
            your other private threads.
          </p>
        </div>

        <ul className="divide-y divide-line">
          {TOOLS.map((tool) => (
            <li key={tool.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-body-sm font-semibold text-fg">{tool.name}</p>
                <p className="text-caption text-fg-subtle">{tool.how}</p>
              </div>
              {tool.link ? (
                <a href={tool.link} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  <ExternalLink size={14} aria-hidden="true" />
                  Add to {tool.name}
                </a>
              ) : (
                <Button size="sm" variant="secondary" leadingIcon={<Copy size={14} aria-hidden="true" />} onClick={() => void copy(tool.copy!)}>
                  {tool.copyLabel ?? "Copy"}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-caption text-fg-subtle">
          Server link: <code className="break-all font-mono">{MCP_URL}</code>
        </p>
      </div>

      <h3 className="mb-3 mt-8 px-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle">Connected</h3>
      {connections.length === 0 ? (
        <p className="px-1 text-body-sm text-fg-muted">Nothing connected yet. A tool shows up here once you click Allow.</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-card">
          {connections.map((c) => (
            <li key={c.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
              <Bot size={16} className="shrink-0 text-fg-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-semibold text-fg">{c.tool}</p>
                <p className="truncate text-caption text-fg-subtle">
                  {c.project} · {c.lastUsed ? `active ${formatRelative(c.lastUsed)}` : "not used yet"}
                </p>
              </div>
              <Button size="sm" variant="danger" loading={removing === c.id} disabled={removing !== null} onClick={() => void remove(c.id)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
