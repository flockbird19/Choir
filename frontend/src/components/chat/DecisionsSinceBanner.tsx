"use client";

import { Pin, X } from "lucide-react";
import type { Message } from "@/types/database";

interface DecisionsSinceBannerProps {
  /** Newest first. */
  decisions: Message[];
  onView: () => void;
  onDismiss: () => void;
}

// Plain one-line preview of a Decision (drops Markdown markers and line breaks).
function preview(content: string): string {
  return content.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

export function DecisionsSinceBanner({ decisions, onView, onDismiss }: DecisionsSinceBannerProps) {
  const count = decisions.length;
  const latest = decisions[0];

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 mt-3 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3"
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-400/20">
        <Pin size={13} className="text-amber-700 dark:text-amber-400" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          Team decided {count === 1 ? "something" : `${count} things`} since you started here
        </p>
        <p className="mt-0.5 truncate text-sm text-graphite" title={preview(latest.content)}>
          {count > 1 ? "Latest: " : ""}
          {preview(latest.content)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onView}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-400/15 dark:text-amber-300"
        >
          View in Team Space
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss decisions notice"
          title="Dismiss"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-graphite transition-colors hover:bg-amber-400/15 hover:text-ink"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
