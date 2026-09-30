"use client";

import { MessagesSquare, Pin, X } from "lucide-react";
import type { Message } from "@/types/database";

interface DecisionsSinceBannerProps {
  /** Newest first. */
  decisions: Message[];
  /** Teammates' new Team Space messages over the same window, newest first. */
  newMessages?: Message[];
  /** Only the newest page of Team Space is loaded, so the true count may be higher. */
  newMessagesIsLowerBound?: boolean;
  onView: () => void;
  onDismiss: () => void;
  /** Display names, keyed by user id, so each item can say who it came from. */
  names?: Record<string, string>;
}

const EMPTY_NAMES: Record<string, string> = {};
const NO_MESSAGES: Message[] = [];

// Plain one-line preview (drops Markdown markers and line breaks).
function preview(content: string): string {
  return content.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

// DESIGN.md 3.2: amber means Decision, so it's used only when a Decision is part of the
// news. New messages alone get the team colour.
export function DecisionsSinceBanner({
  decisions,
  newMessages = NO_MESSAGES,
  newMessagesIsLowerBound = false,
  onView,
  onDismiss,
  names = EMPTY_NAMES,
}: DecisionsSinceBannerProps) {
  const hasDecisions = decisions.length > 0;
  const messageCount = `${newMessages.length}${newMessagesIsLowerBound ? "+" : ""}`;
  const messagesLabel = `${messageCount} new message${newMessages.length === 1 && !newMessagesIsLowerBound ? "" : "s"}`;

  const tone = hasDecisions
    ? { box: "border-decision-line bg-decision-soft", icon: "text-decision", action: "text-decision hover:bg-decision-line/40", close: "hover:bg-decision-line/40" }
    : { box: "border-team-line bg-team-soft", icon: "text-team", action: "text-team hover:bg-team-line/40", close: "hover:bg-team-line/40" };

  let title: string;
  let detail: string;
  let byline: string | null;
  if (hasDecisions) {
    const latest = decisions[0];
    title = `Team decided ${decisions.length === 1 ? "something" : `${decisions.length} things`} since you last opened Team Space`;
    detail = `${decisions.length > 1 ? "Latest: " : ""}${preview(latest.content)}`;
    byline = latest.pinned_by ? `pinned by ${names[latest.pinned_by] ?? "a teammate"}` : null;
  } else {
    const latest = newMessages[0];
    const from = latest.sender_type === "assistant" ? "Choir AI" : names[latest.sender_id ?? ""] ?? "a teammate";
    title = `${messagesLabel} in Team Space since you last opened it`;
    detail = `Latest from ${from}: ${preview(latest.content)}`;
    byline = null;
  }

  return (
    <div role="status" aria-live="polite" className={`mx-4 mt-3 flex items-start gap-3 rounded-card border px-4 py-3 ${tone.box}`}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control">
        {hasDecisions ? (
          <Pin size={13} className={tone.icon} aria-hidden="true" />
        ) : (
          <MessagesSquare size={13} className={tone.icon} aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 truncate text-sm text-fg-muted" data-tooltip={detail}>
          {detail}
          {byline && <span className="text-fg-subtle"> · {byline}</span>}
        </p>
        {hasDecisions && newMessages.length > 0 && (
          <p className="mt-0.5 text-caption text-fg-muted">Also {messagesLabel} in Team Space</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={onView} className={`rounded-control px-2.5 py-1.5 text-xs font-medium transition-colors ${tone.action}`}>
          View in Team Space
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss Team Space updates"
          data-tooltip="Dismiss"
          className={`flex h-7 w-7 items-center justify-center rounded-control text-fg-muted transition-colors hover:text-fg ${tone.close}`}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
