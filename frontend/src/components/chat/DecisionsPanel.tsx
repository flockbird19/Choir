"use client";

import { X, Pin, Eye, MessageSquareLock } from "lucide-react";
import { Message } from "@/types/database";
import { messageText } from "@/utils/attachments";
import { Sheet, IconButton } from "@/components/ui";
import { whoHasSeen } from "@/hooks/useSeenBy";
import { useDecisionTrailModels } from "@/hooks/useDecisionTrail";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "@/hooks/useTeammateStatuses";
import { stripMarkdownSyntax } from "@/utils/markdown-preview";
import type { StatusId } from "@/app/(main)/profile/actions";

interface DecisionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  decisions: Message[];
  onJumpTo: (id: string) => void;
  onUnpin: (id: string) => void;
  currentUserId: string;
  memberNames: Record<string, string>;
  namesLoaded: boolean;
  /** Whether the Decisions fetch has finished; until then the panel says it's loading, not "none". */
  decisionsLoaded?: boolean;
  /** E5: { userId: last_read_at }. */
  seenBy?: Record<string, string>;
  /** E4 follow-up: { userId: status }, so the author's name can show it. */
  statuses?: Record<string, StatusId>;
}

const EMPTY_SEEN_BY: Record<string, string> = {};
const EMPTY_STATUSES: Record<string, StatusId> = {};

// K3: "from X's private exploration · model" — a detail line, not a panel.
function DecisionTrail({ msg, possessive }: { msg: Message; possessive: string }) {
  const hasTrail = !!msg.source_message_ids && msg.source_message_ids.length > 0;
  const models = useDecisionTrailModels(msg.id, hasTrail);
  if (!hasTrail) return null;
  return (
    <p className="flex items-center gap-1 text-[10px] text-fg-subtle mb-1.5">
      <MessageSquareLock size={10} aria-hidden="true" className="shrink-0" />
      From {possessive} private exploration
      {models.length > 0 && <span className="font-mono">· {models.join(", ")}</span>}
    </p>
  );
}

export function DecisionsPanel({
  isOpen,
  onClose,
  decisions,
  onJumpTo,
  onUnpin,
  currentUserId,
  memberNames,
  namesLoaded,
  decisionsLoaded = true,
  seenBy = EMPTY_SEEN_BY,
  statuses = EMPTY_STATUSES,
}: DecisionsPanelProps) {
  const personName = (userId: string | null | undefined) =>
    userId === currentUserId ? "You" : memberNames[userId ?? ""] ?? (namesLoaded ? "Former member" : "Teammate");
  const authorName = (msg: Message) => (msg.sender_type === "assistant" ? "Choir AI" : personName(msg.sender_id));

  return (
    <Sheet open={isOpen} onClose={onClose} side="right" title="Decisions panel" hideHeader>
      {/* Sheet's own children slot is the scroll container; nest our own
          header/list/footer inside it so the footer stays pinned instead of
          scrolling away with the decisions list. */}
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-line flex items-center justify-between bg-sunken shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-control bg-decision-soft flex items-center justify-center shrink-0">
              <Pin size={13} className="text-decision" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-fg font-display">Decisions</h3>
              <p className="text-[10px] text-fg-subtle">
                {decisionsLoaded ? `${decisions.length} pinned in this Team Space` : "Pinned in this Team Space"}
              </p>
            </div>
          </div>
          <IconButton label="Close decisions panel" icon={<X size={16} />} onClick={onClose} />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {decisions.length === 0 && !decisionsLoaded ? (
            <p role="status" className="p-8 text-center text-sm text-fg-muted">
              Loading decisions…
            </p>
          ) : decisions.length === 0 ? (
            <div className="p-8 text-center">
              <Pin size={20} className="text-fg-subtle mx-auto mb-2" />
              <p className="text-sm font-medium text-fg mb-1">No decisions pinned yet</p>
              <p className="text-xs text-fg-muted leading-relaxed">
                Hover any message in the Team Space and pin it to record it here.
              </p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {decisions.map((msg) => (
                <div key={msg.id} className="p-3 rounded-card border border-line bg-sunken group">
                  <p className="text-[11px] text-fg-muted mb-1">
                    <span className="font-semibold text-fg">{authorName(msg)}</span>
                    {msg.sender_type !== "assistant" && msg.sender_id && (
                      <span
                        role="img"
                        aria-label={`${authorName(msg)} — ${STATUS_LABEL[statuses[msg.sender_id] ?? "online"]}`}
                        data-tooltip={STATUS_LABEL[statuses[msg.sender_id] ?? "online"]}
                        className={`inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle ${STATUS_DOT_CLASS[statuses[msg.sender_id] ?? "online"]}`}
                      />
                    )}
                    {msg.pinned_by && (
                      <> · pinned by {msg.pinned_by === currentUserId ? "you" : personName(msg.pinned_by)}</>
                    )}
                  </p>
                  <DecisionTrail
                    msg={msg}
                    possessive={msg.sender_id === currentUserId ? "your own" : `${authorName(msg)}'s`}
                  />
                  <p className="text-sm text-fg leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {stripMarkdownSyntax(messageText(msg))}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-fg-subtle">
                      {msg.pinned_at
                        ? new Date(msg.pinned_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                      {(() => {
                        const seen = whoHasSeen(msg.created_at, msg.sender_id, seenBy, memberNames, currentUserId);
                        if (seen.length === 0) return null;
                        return (
                          <span
                            className="flex items-center gap-0.5"
                            data-tooltip={`Seen by ${seen.map((p) => p.name).join(", ")}`}
                          >
                            <Eye size={10} aria-hidden="true" />
                            {seen.length}
                            <span className="sr-only"> seen by {seen.map((p) => p.name).join(", ")}</span>
                          </span>
                        );
                      })()}
                    </span>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => onJumpTo(msg.id)}
                        className="text-[11px] font-medium text-team hover:underline"
                      >
                        Jump to
                      </button>
                      <span className="text-fg-subtle">·</span>
                      <button
                        onClick={() => onUnpin(msg.id)}
                        className="text-[11px] font-medium text-fg-muted hover:text-danger transition-colors"
                      >
                        Unpin
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-line bg-sunken shrink-0">
          <p className="text-[10px] text-fg-subtle text-center leading-relaxed">
            Pinned messages are visible to the whole team
          </p>
        </div>
      </div>
    </Sheet>
  );
}
