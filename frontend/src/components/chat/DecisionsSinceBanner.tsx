"use client";

import { Pin, X } from "lucide-react";
import type { Message } from "@/types/database";

interface DecisionsSinceBannerProps {
  /** Newest first. */
  decisions: Message[];
  onView: () => void;
  onDismiss: () => void;
  /** Display names, keyed by user id, so each decision can say who pinned it. */
  names?: Record<string, string>;
}

const EMPTY_NAMES: Record<string, string> = {};

// Plain one-line preview of a Decision (drops Markdown markers and line breaks).
function preview(content: string): string {
  return content.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

export function DecisionsSinceBanner({ decisions, onView, onDismiss, names = EMPTY_NAMES }: DecisionsSinceBannerProps) {
  const count = decisions.length;
  const latest = decisions[0];
  const pinner = latest.pinned_by ? names[latest.pinned_by] ?? "a teammate" : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 mt-3 flex items-start gap-3 rounded-card border border-decision-line bg-decision-soft px-4 py-3"
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-decision-soft">
        <Pin size={13} className="text-decision" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">
          Team decided {count === 1 ? "something" : `${count} things`} since you started here
        </p>
        <p className="mt-0.5 truncate text-sm text-fg-muted" title={preview(latest.content)}>
          {count > 1 ? "Latest: " : ""}
          {preview(latest.content)}
          {pinner && <span className="text-fg-subtle"> · pinned by {pinner}</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onView}
          className="rounded-control px-2.5 py-1.5 text-xs font-medium text-decision transition-colors hover:bg-decision-line/40"
        >
          View in Team Space
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss decisions notice"
          title="Dismiss"
          className="flex h-7 w-7 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-decision-line/40 hover:text-fg"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
