"use client";

import { useEffect, useId, useState } from "react";
import { Bot, Check, ChevronDown, Copy } from "lucide-react";
import { connectAgent } from "@/app/(main)/thread/[id]/actions";
import { getSharedKeysSetup } from "./sharedKeysActions";
import { Button, Menu, MenuRadioItem } from "@/components/ui";

const AGENT_KINDS = ["Claude Code", "Cursor", "Codex", "Other"];

/**
 * M1/M2 spike: connect a coding agent to a project over MCP. The token is shown
 * once (never stored anywhere retrievable, the backend only keeps its hash) — this
 * mirrors how an invite link is shown once in InviteLinks.tsx.
 */
export function ConnectAgentPanel() {
  const selectId = useId();
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof getSharedKeysSetup>>>(null);
  const [setupLoaded, setSetupLoaded] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState(AGENT_KINDS[0]);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSharedKeysSetup()
      .then((result) => {
        if (cancelled) return;
        setSetup(result);
        setProjectId((current) => current || result?.projects[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your projects. Refresh the page to try again.");
      })
      .finally(() => {
        if (!cancelled) setSetupLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const project = setup?.projects.find((p) => p.id === projectId);
  const projectLabel = (p: NonNullable<typeof setup>["projects"][number]) =>
    p.teamName && p.teamName !== p.name ? `${p.teamName} / ${p.name}` : p.name;

  const handleConnect = async () => {
    if (!projectId) return;
    setConnecting(true);
    setError(null);
    const result = await connectAgent(projectId, kind);
    if (result.error) setError(result.error);
    else if (result.token) setToken(result.token);
    setConnecting(false);
  };

  const handleCopy = () => {
    if (!token) return;
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-fg-subtle mb-3 px-1">
        Connect your AI
      </h2>
      <div className="bg-card border border-line rounded-card p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-control bg-hover flex items-center justify-center shrink-0">
            <Bot size={16} className="text-fg-muted" aria-hidden="true" />
          </div>
          <p className="text-sm text-fg-muted leading-relaxed">
            Let Claude Code, Cursor, or Codex read this project&rsquo;s Team Space and post back into it,
            using your own AI — nothing here spends Choir&rsquo;s credits. It only sees what has already
            been shared with the team, never your private threads.
          </p>
        </div>

        {!setupLoaded ? (
          <p className="text-sm text-fg-muted">Loading your projects…</p>
        ) : !setup || setup.projects.length === 0 ? (
          <p className="text-sm text-fg-muted">Join or create a workspace first.</p>
        ) : token ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-danger">
              This token will not be shown again. Paste it into your tool&rsquo;s MCP config now.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={token}
                aria-label="Agent token"
                className="focus-ring-in-container flex-1 px-3 py-2 text-sm bg-card border border-field-line rounded-control text-fg font-mono outline-none focus:border-team focus:ring-2 focus:ring-team/25"
              />
              <Button variant="primary" onClick={handleCopy} leadingIcon={copied ? <Check size={14} /> : <Copy size={14} />}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-fg-subtle">
              Server URL: <code className="font-mono">{"<your backend URL>"}/mcp</code> · send the token as{" "}
              <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setToken(null)} className="self-start">
              Connect another
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span id={selectId} className="text-xs font-medium text-fg-muted">
                Project
              </span>
              <Menu
                label="Project"
                wrapperClassName="w-full"
                trigger={(props) => (
                  <button
                    {...props}
                    type="button"
                    aria-labelledby={`${selectId} ${props.id}`}
                    disabled={connecting}
                    className="focus-ring-in-container flex w-full items-center justify-between gap-2 px-3.5 h-11 sm:h-10 text-sm bg-card border border-field-line rounded-control text-fg outline-none focus:border-team focus:ring-2 focus:ring-team/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="truncate">{project ? projectLabel(project) : "Select a project"}</span>
                    <ChevronDown size={16} className="text-fg-muted shrink-0" aria-hidden="true" />
                  </button>
                )}
              >
                {setup.projects.map((p) => (
                  <MenuRadioItem key={p.id} checked={p.id === projectId} onSelect={() => setProjectId(p.id)}>
                    {projectLabel(p)}
                  </MenuRadioItem>
                ))}
              </Menu>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Tool</span>
              <Menu
                label="Tool"
                wrapperClassName="w-full"
                trigger={(props) => (
                  <button
                    {...props}
                    type="button"
                    aria-label="Tool"
                    disabled={connecting}
                    className="focus-ring-in-container flex w-full items-center justify-between gap-2 px-3.5 h-11 sm:h-10 text-sm bg-card border border-field-line rounded-control text-fg outline-none focus:border-team focus:ring-2 focus:ring-team/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="truncate">{kind}</span>
                    <ChevronDown size={16} className="text-fg-muted shrink-0" aria-hidden="true" />
                  </button>
                )}
              >
                {AGENT_KINDS.map((k) => (
                  <MenuRadioItem key={k} checked={k === kind} onSelect={() => setKind(k)}>
                    {k}
                  </MenuRadioItem>
                ))}
              </Menu>
            </div>

            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}

            <Button variant="primary" size="md" onClick={handleConnect} disabled={!projectId || connecting} loading={connecting} className="self-start">
              Create token
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
