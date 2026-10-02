"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button, Skeleton, cn } from "@/components/ui";
import { createClient } from "@/utils/supabase/client";
import { connectAgent } from "@/app/(main)/agents/actions";

type Details = { clientId: string; clientName: string; email: string };
export type ProjectOption = { id: string; label: string };

/**
 * The "Allow" card: names the tool asking, lets the person pick which project it works on, says
 * plainly what it can and can't do, and sends the browser back to the tool with Supabase's answer.
 * Nothing is decided here without a click.
 */
export function ConsentCard({ authorizationId, projects }: { authorizationId: string | null; projects: ProjectOption[] }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [error, setError] = useState<string | null>(
    !authorizationId
      ? "This link is missing its request. Start connecting again from your coding tool."
      : projects.length === 0
        ? "Join or create a team in Choir first, then connect your tool again."
        : null
  );
  const [busy, setBusy] = useState<"allow" | "cancel" | null>(null);

  useEffect(() => {
    if (!authorizationId || projects.length === 0) return;
    void (async () => {
      const { data, error: err } = await createClient().auth.oauth.getAuthorizationDetails(authorizationId);
      if (err || !data) {
        setError("This request has expired or was already used. Start connecting again from your coding tool.");
        return;
      }
      // Already allowed before: Supabase answers straight away.
      if ("redirect_url" in data) {
        window.location.href = data.redirect_url;
        return;
      }
      setDetails({ clientId: data.client.id, clientName: data.client.name || "A coding tool", email: data.user.email });
    })();
  }, [authorizationId, projects.length]);

  const decide = async (allow: boolean) => {
    if (!authorizationId || !details) return;
    setBusy(allow ? "allow" : "cancel");
    if (allow) {
      const saved = await connectAgent(details.clientId, details.clientName, projectId);
      if (saved.error) {
        setBusy(null);
        setError(saved.error);
        return;
      }
    }
    const oauth = createClient().auth.oauth;
    const { data, error: err } = allow ? await oauth.approveAuthorization(authorizationId) : await oauth.denyAuthorization(authorizationId);
    if (err || !data) {
      setBusy(null);
      setError("Choir couldn't send your answer. Please try again from your coding tool.");
      return;
    }
    window.location.href = data.redirect_url;
  };

  return (
    <div className="w-full max-w-[26rem] space-y-5 rounded-panel border border-line bg-card p-6 shadow-overlay">
      <div className="flex items-center gap-2 text-fg">
        <Logo className="h-6 w-6" />
        <span className="font-display text-xl">Choir</span>
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-fg">
          {error}
        </p>
      ) : !details ? (
        <div className="space-y-3" aria-label="Loading">
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <h1 className="font-display text-[22px] leading-tight text-fg [text-wrap:balance]">
              {details.clientName} wants to work on your tasks
            </h1>
            <p className="text-caption text-fg-subtle">Signed in as {details.email}</p>
          </div>

          {projects.length === 1 ? (
            <p className="text-body-sm text-fg-muted">
              Works in <span className="font-semibold text-fg">{projects[0].label}</span>
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-body-sm font-semibold text-fg">Which project should it work in?</legend>
              <div className="divide-y divide-line overflow-hidden rounded-card border border-line">
                {projects.map((p) => (
                  <label
                    key={p.id}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 px-3.5 text-body-sm hover:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring",
                      projectId === p.id ? "bg-selected font-semibold text-fg" : "text-fg-muted"
                    )}
                  >
                    <input
                      type="radio"
                      name="project"
                      value={p.id}
                      checked={projectId === p.id}
                      onChange={() => setProjectId(p.id)}
                      className="size-4 accent-[var(--color-fg)]"
                    />
                    <span className="min-w-0 truncate">{p.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-caption text-fg-subtle">One project at a time. Connecting it again moves it.</p>
            </fieldset>
          )}

          <ul className="space-y-2 text-body-sm">
            <li className="flex gap-2 text-fg">
              <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              Read Team Space, Decisions and the task list
            </li>
            <li className="flex gap-2 text-fg">
              <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              Work on tasks you give it, and message you in that task&rsquo;s private thread
            </li>
            <li className="flex gap-2 text-fg-muted">
              <X size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              Post in Team Space, mark tasks done, or read your other private threads
            </li>
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" loading={busy === "cancel"} disabled={busy !== null} onClick={() => void decide(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === "allow"} disabled={busy !== null || !projectId} onClick={() => void decide(true)}>
              Allow
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
