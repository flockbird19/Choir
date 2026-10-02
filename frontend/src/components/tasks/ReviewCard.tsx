"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, Bot, Check, ShieldAlert, Undo2 } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { removeSecret, scanForSecrets } from "@/utils/secrets";
import { completeTask, sendBackTask } from "@/app/(main)/tasks/actions";
// Same safe renderer as chat bubbles (no raw HTML).
import { markdownComponents, markdownRehype } from "@/components/chat/MessageList";

type ReviewMessage = {
  id: string;
  created_at: string;
  content: string;
  task_id?: string | null;
  review?: { summary?: string; suggested_result?: string; links?: string[] } | null;
  review_state?: "open" | "done" | "sent_back" | null;
};

const STATE_LABEL = { open: "Waiting for you", done: "Marked done", sent_back: "Sent back" } as const;

function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Feature D stage 2: a coding agent's "ready for review" card in the task's private thread. Only the
 * person it works for sees it; they mark the task done (the result goes to Team Space, after the
 * privacy check) or send it back with a note the agent reads next time it checks.
 */
export function ReviewCard({ msg, tool, canAnswer }: { msg: ReviewMessage; tool: string; canAnswer: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState<"view" | "done" | "back">("view");
  const [result, setResult] = useState(msg.review?.suggested_result ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const state = msg.review_state ?? null;
  const open = state === "open";
  const matches = mode === "done" ? scanForSecrets(result) : [];
  const credentials = matches.filter((m) => m.kind === "credential");
  const contacts = matches.filter((m) => m.kind === "contact");
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const submit = async () => {
    if (!msg.task_id) return;
    setBusy(true);
    const res = mode === "done" ? await completeTask(msg.task_id, result) : await sendBackTask(msg.task_id, note);
    setBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(mode === "done" ? "Marked done. The team sees it in Team Space." : `Sent back to ${tool}.`);
    setMode("view");
  };

  return (
    <div id={`message-${msg.id}`} className="mx-auto w-full max-w-xl py-1">
      <div className="space-y-3 rounded-card border border-line bg-card px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full bg-sunken text-fg-muted">
            <Bot size={13} aria-hidden="true" />
          </span>
          <p className="min-w-0 flex-1 text-body-sm font-semibold text-fg">{tool} says this is ready for your review</p>
          <span className="inline-flex h-[22px] shrink-0 items-center rounded-full border border-line bg-sunken px-2 font-mono text-[11px] text-fg-muted">
            {state ? STATE_LABEL[state] : "Replaced"}
          </span>
        </div>

        <div className="break-words text-body-sm text-fg">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={markdownRehype} components={markdownComponents}>
            {msg.review?.summary || msg.content}
          </ReactMarkdown>
        </div>

        {msg.review?.suggested_result && mode !== "done" && (
          <div className="rounded-control border border-line bg-sunken px-2.5 py-2">
            <span className="block font-mono text-[11px] uppercase tracking-[0.06em] text-fg-subtle">Suggested result</span>
            <p className="whitespace-pre-wrap break-words text-body-sm text-fg">{msg.review.suggested_result}</p>
          </div>
        )}

        {!!msg.review?.links?.length && (
          <div className="flex flex-wrap gap-1.5">
            {msg.review.links.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                data-tooltip={url}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-card px-2.5 font-mono text-[12px] text-fg-muted hover:border-line-strong hover:text-fg"
              >
                {domain(url)}
                <ArrowUpRight size={12} aria-hidden="true" />
              </a>
            ))}
          </div>
        )}

        {mode === "done" && (
          <div className="space-y-2">
            <Textarea
              label="Result"
              hint="Everyone sees this in Team Space. Edit it as you like."
              value={result}
              maxLength={1000}
              rows={3}
              autoFocus
              onChange={(e) => setResult(e.target.value)}
            />
            {credentials.length > 0 && (
              <div role="alert" className="space-y-1.5 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-body-sm text-fg">
                <p className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert size={14} aria-hidden="true" className="text-danger" />
                  This looks like it contains a secret
                </p>
                {credentials.map((m) => (
                  <div key={m.value} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {m.label}: {m.display}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setResult((r) => removeSecret(r, m.value))}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {contacts.length > 0 && (
              <p className="rounded-control bg-sunken px-3 py-2 text-caption text-fg-muted">
                It mentions {contacts.map((m) => m.display).join(", ")}. Everyone on the team will see it.
              </p>
            )}
            <p className="text-caption text-fg-subtle">The privacy check can miss things. Read it before you save.</p>
          </div>
        )}

        {mode === "back" && (
          <Textarea
            label="What should change?"
            hint={`${tool} reads this in the task thread next time it checks.`}
            value={note}
            maxLength={2000}
            rows={3}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto font-mono text-[11px] text-fg-subtle">{time}</span>
          {open && canAnswer && mode === "view" && (
            <>
              <Button size="sm" variant="secondary" leadingIcon={<Undo2 size={14} aria-hidden="true" />} onClick={() => setMode("back")}>
                Send back
              </Button>
              <Button size="sm" variant="primary" leadingIcon={<Check size={14} aria-hidden="true" />} onClick={() => setMode("done")}>
                Mark done
              </Button>
            </>
          )}
          {mode !== "view" && (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("view")}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                disabled={mode === "back" && !note.trim()}
                onClick={() => void submit()}
              >
                {mode === "back" ? "Send back" : credentials.length > 0 ? "Mark done anyway" : "Mark done"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
