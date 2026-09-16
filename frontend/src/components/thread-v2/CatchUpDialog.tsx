"use client";

import Link from "next/link";
import { KeyRound, Pin, Sparkles } from "lucide-react";
import type { Message } from "@/types/database";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Markdown } from "./Markdown";

const MAX_DECISIONS_SHOWN = 5;

export interface CatchUpState {
  open: boolean;
  loading: boolean;
  summary: string | null;
  count: number | null;
  /** The viewer has no API key, so no AI summary could be written. */
  needsKey: boolean;
}

export const CLOSED_CATCH_UP: CatchUpState = { open: false, loading: false, summary: null, count: null, needsKey: false };

function plain(content: string): string {
  return content.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

function NoKeyState({ decisions, onClose }: { decisions: Message[]; onClose: () => void }) {
  const shown = [...decisions]
    .sort((a, b) => Date.parse(b.pinned_at ?? b.created_at) - Date.parse(a.pinned_at ?? a.created_at))
    .slice(0, MAX_DECISIONS_SHOWN);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-control bg-sunken text-fg-muted">
          <KeyRound size={16} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body font-semibold text-fg">Add an API key to get an AI summary</p>
          <p className="text-body-sm text-fg-muted">
            Catch me up writes its summary with your own API key. Add one in Settings and try again, or scroll up to read
            the conversation.
          </p>
          <Link href="/settings" onClick={onClose} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-2 self-start" })}>
            <KeyRound size={14} aria-hidden="true" />
            Add a key in Settings
          </Link>
        </div>
      </div>

      {shown.length > 0 && (
        <section aria-labelledby="catchup-decisions" className="border-t border-line pt-4">
          <h3 id="catchup-decisions" className="mb-2 text-label font-semibold text-fg-muted">
            Decisions so far
          </h3>
          <ul className="flex flex-col gap-2">
            {shown.map((decision) => (
              <li key={decision.id} className="flex gap-2 text-body-sm text-fg">
                <Pin size={14} aria-hidden="true" className="mt-0.5 shrink-0 fill-current text-decision" />
                <span className="line-clamp-2 [overflow-wrap:anywhere]">{plain(decision.content)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function CatchUpDialog({
  state,
  decisions,
  onClose,
}: {
  state: CatchUpState;
  /** Pinned Decisions, shown without AI when there's no key. */
  decisions: Message[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open={state.open}
      onClose={onClose}
      title="Catch me up"
      description="What changed in the shared thread since your last visit."
      width="36rem"
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      {state.loading ? (
        <div className="flex flex-col gap-2.5 py-2" role="status">
          <span className="sr-only">Writing your summary</span>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="mt-3 h-4 w-1/2" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : state.needsKey ? (
        <NoKeyState decisions={decisions} onClose={onClose} />
      ) : state.summary ? (
        <div className="flex flex-col gap-3">
          <div className="text-body text-fg">
            <Markdown>{state.summary}</Markdown>
          </div>
          {state.count !== null && state.count > 0 && (
            <p className="text-caption text-fg-subtle">
              Based on {state.count} new message{state.count === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      ) : (
        <EmptyState compact icon={<Sparkles />} title="You're all caught up" description="Nothing new since your last visit." />
      )}
    </Dialog>
  );
}
