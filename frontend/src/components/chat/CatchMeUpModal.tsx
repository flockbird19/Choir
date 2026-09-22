"use client";

import Link from "next/link";
import { Sparkles, KeyRound, Pin } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "./MessageList";
import { Button, Dialog } from "@/components/ui";
import { stripMarkdownSyntax } from "@/utils/markdown-preview";
import type { Message } from "@/types/database";

interface CatchMeUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  summary: string | null;
  messageCount: number | null;
  /** The viewer has no API key, so no AI summary could be made. */
  needsApiKey?: boolean;
  /** Pinned Decisions, shown without AI when there's no key. */
  decisions?: Message[];
  /** Display names, keyed by user id, so each decision can say who pinned it. */
  names?: Record<string, string>;
}

const MAX_DECISIONS_SHOWN = 5;

export function CatchMeUpModal({
  isOpen,
  onClose,
  isLoading,
  summary,
  messageCount,
  needsApiKey = false,
  decisions = [],
  names = {},
}: CatchMeUpModalProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-control bg-team-soft flex items-center justify-center shrink-0">
            <Sparkles size={15} className="text-team" aria-hidden="true" />
          </span>
          Catch me up
        </span>
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-3 text-sm text-fg-muted py-6">
          <div className="w-4 h-4 border-2 border-line-strong border-t-team rounded-full animate-spin" />
          Summarizing what you missed…
        </div>
      ) : needsApiKey ? (
        <NoKeyState decisions={decisions} names={names} onNavigate={onClose} />
      ) : (
        <>
          <div className="text-sm text-fg leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {summary || ""}
            </ReactMarkdown>
          </div>
          {messageCount !== null && messageCount > 0 && (
            <p className="text-[11px] text-fg-subtle mt-4">
              Based on {messageCount} new message{messageCount === 1 ? "" : "s"}.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}

function NoKeyState({
  decisions,
  names,
  onNavigate,
}: {
  decisions: Message[];
  names: Record<string, string>;
  onNavigate: () => void;
}) {
  const shown = [...decisions]
    .sort((a, b) => Date.parse(b.pinned_at ?? b.created_at) - Date.parse(a.pinned_at ?? a.created_at))
    .slice(0, MAX_DECISIONS_SHOWN);

  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed">
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-control bg-hover flex items-center justify-center shrink-0">
          <KeyRound size={15} className="text-fg-muted" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium text-fg">Add an API key to get an AI summary</p>
          <p className="text-fg-muted mt-0.5">
            Catch Me Up summarizes what you missed using your own API key. Add one in Settings and try again, or
            scroll up to read the conversation.
          </p>
          <Link
            href="/settings"
            onClick={onNavigate}
            className="inline-block mt-2 text-sm font-medium text-team hover:underline"
          >
            Add a key in Settings
          </Link>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="border-t border-line pt-4">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">
            Decisions so far
          </p>
          <ul className="space-y-2">
            {shown.map((d) => (
              <li key={d.id} className="flex gap-2 text-fg">
                <Pin size={13} className="mt-1 shrink-0 text-decision" aria-hidden="true" />
                <div>
                  <span className="line-clamp-2 whitespace-pre-wrap">{stripMarkdownSyntax(d.content)}</span>
                  {d.pinned_by && (
                    <p className="text-[11px] text-fg-subtle">Pinned by {names[d.pinned_by] ?? "a teammate"}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {decisions.length > shown.length && (
            <p className="text-[11px] text-fg-subtle mt-2">
              +{decisions.length - shown.length} more in the Decisions panel.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
