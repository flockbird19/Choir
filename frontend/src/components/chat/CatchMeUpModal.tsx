"use client";

import Link from "next/link";
import { X, Sparkles, KeyRound, Pin } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "./MessageList";
import { useDialogA11y } from "@/hooks/useDialogA11y";
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
}: CatchMeUpModalProps) {
  const dialogRef = useDialogA11y(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Catch me up"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4"
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg border border-border max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Sparkles size={15} className="text-accent" />
            </div>
            <h3 className="text-base font-semibold text-ink">Catch me up</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-graphite hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-3 text-sm text-graphite py-6">
              <div className="w-4 h-4 border-2 border-graphite/25 border-t-accent rounded-full animate-spin" />
              Summarizing what you missed…
            </div>
          ) : needsApiKey ? (
            <NoKeyState decisions={decisions} onNavigate={onClose} />
          ) : (
            <>
              <div className="text-sm text-ink leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {summary || ""}
                </ReactMarkdown>
              </div>
              {messageCount !== null && messageCount > 0 && (
                <p className="text-[11px] text-graphite/50 mt-4">
                  Based on {messageCount} new message{messageCount === 1 ? "" : "s"}.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-border shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-surface-hover text-ink rounded-xl hover:bg-border transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function NoKeyState({ decisions, onNavigate }: { decisions: Message[]; onNavigate: () => void }) {
  const shown = [...decisions]
    .sort((a, b) => Date.parse(b.pinned_at ?? b.created_at) - Date.parse(a.pinned_at ?? a.created_at))
    .slice(0, MAX_DECISIONS_SHOWN);

  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed">
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
          <KeyRound size={15} className="text-graphite" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium text-ink">Add an API key to get an AI summary</p>
          <p className="text-graphite mt-0.5">
            Catch Me Up summarizes what you missed using your own API key. Add one in Settings and try again, or
            scroll up to read the conversation.
          </p>
          <Link
            href="/settings"
            onClick={onNavigate}
            className="inline-block mt-2 text-sm font-medium text-accent hover:underline"
          >
            Add a key in Settings
          </Link>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="border-t border-border pt-4">
          <p className="text-xs font-semibold text-graphite uppercase tracking-wide mb-2">
            Decisions so far
          </p>
          <ul className="space-y-2">
            {shown.map((d) => (
              <li key={d.id} className="flex gap-2 text-ink">
                <Pin size={13} className="mt-1 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="line-clamp-2 whitespace-pre-wrap">{d.content}</span>
              </li>
            ))}
          </ul>
          {decisions.length > shown.length && (
            <p className="text-[11px] text-graphite/60 mt-2">
              +{decisions.length - shown.length} more in the Decisions panel.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
