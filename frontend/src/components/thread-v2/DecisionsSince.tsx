"use client";

import { Pin, X } from "lucide-react";
import type { Message } from "@/types/database";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";

// One-line preview of a Decision (drops Markdown markers and line breaks).
function preview(content: string): string {
  return content.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

/** "Team decided since you started" notice for private threads (K4). */
export function DecisionsSince({
  decisions,
  sharedName,
  onView,
  onDismiss,
}: {
  /** Newest first. */
  decisions: Message[];
  sharedName: string;
  onView: () => void;
  onDismiss: () => void;
}) {
  const count = decisions.length;
  const latest = preview(decisions[0].content);

  return (
    <div role="status" className="shrink-0 border-b border-decision-line bg-decision-soft px-3 py-2 sm:px-4">
      <div className="mx-auto flex w-full max-w-measure items-center gap-3">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-control bg-card text-decision">
          <Pin size={15} className="fill-current" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-fg">
            {sharedName} decided {count === 1 ? "something" : `${count} things`} since you were last here
          </p>
          <p className="truncate text-label text-fg-muted" title={latest}>
            {count > 1 ? "Latest: " : ""}
            {latest}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onView} className="shrink-0 text-decision hover:text-decision">
          View
        </Button>
        <IconButton label="Dismiss this notice" icon={<X />} size="sm" tooltip={false} onClick={onDismiss} />
      </div>
    </div>
  );
}
