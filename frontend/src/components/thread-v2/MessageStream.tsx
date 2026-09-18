"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Loader2 } from "lucide-react";
import type { Message } from "@/types/database";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { Markdown } from "./Markdown";
import { MessageRow, type SenderKind } from "./MessageRow";
import { continuesGroup, dayKey, formatDayLabel } from "./format";
import { whoHasSeen } from "@/hooks/useSeenBy";

const NEAR_BOTTOM_PX = 120;
const ANNOUNCE_MAX_CHARS = 160;

// Plain-text preview for screen reader announcements (drops Markdown markers).
function spokenPreview(content: string): string {
  const text = content.replace(/[*_`#>|~]/g, "").replace(/\s+/g, " ").trim();
  return text.length > ANNOUNCE_MAX_CHARS ? `${text.slice(0, ANNOUNCE_MAX_CHARS)}…` : text;
}

export interface MessageStreamProps {
  messages: Message[];
  currentUserId: string;
  currentUserName: string;
  names: Record<string, string>;
  namesLoaded: boolean;
  canPin: boolean;
  selectMode: boolean;
  selectedIds: Set<string>;
  highlightedId: string | null;
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDiscussPrivately?: (id: string) => void;
  /** AI reply being streamed: null while waiting for the first words. */
  streaming: { text: string | null; model: string } | null;
  /** Bumped when the current user sends, to always scroll to their message. */
  scrollToEndSignal: number;
  empty: ReactNode;
  compact?: boolean;
  label: string;
  /** E5 "Seen by": { userId: last_read_at }, shared threads only. */
  seenBy?: Record<string, string>;
  /** Called when the reader scrolls to (or away from) the bottom. */
  onNearBottomChange?: (near: boolean) => void;
  /** C3 "Load older": pages further back by a created_at cursor. */
  onLoadOlder?: () => void;
  hasMoreOlder?: boolean;
  loadingOlder?: boolean;
}

const EMPTY_SEEN_BY: Record<string, string> = {};

export function senderOf(
  message: Message,
  currentUserId: string,
  currentUserName: string,
  names: Record<string, string>,
  namesLoaded: boolean
): { kind: SenderKind; name: string } {
  if (message.sender_type === "assistant") return { kind: "ai", name: "Choir AI" };
  // Optimistic messages are always the current user's.
  if (!message.sender_id || message.sender_id === currentUserId) return { kind: "own", name: currentUserName };
  return { kind: "teammate", name: names[message.sender_id] ?? (namesLoaded ? "Former member" : "Teammate") };
}

export function MessageStream({
  messages,
  currentUserId,
  currentUserName,
  names,
  namesLoaded,
  canPin,
  selectMode,
  selectedIds,
  highlightedId,
  onToggleSelect,
  onTogglePin,
  onDiscussPrivately,
  streaming,
  scrollToEndSignal,
  empty,
  compact = false,
  label,
  seenBy = EMPTY_SEEN_BY,
  onNearBottomChange,
  onLoadOlder,
  hasMoreOlder = false,
  loadingOlder = false,
}: MessageStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastCount = useRef(messages.length);
  const [unseen, setUnseen] = useState(0);
  // Set right before "load older" runs; consumed once the prepended messages have
  // rendered, to keep the reader's spot instead of jumping to the new top.
  const pendingScrollAdjust = useRef<number | null>(null);

  // Screen readers hear each finished message from someone else once. The list itself is not a
  // live region, so a streaming AI reply isn't re-read as every chunk arrives, and your own
  // messages aren't read back to you.
  const [announcement, setAnnouncement] = useState("");
  const announcedCount = useRef(messages.length);
  const latest = useRef({ messages, currentUserId, currentUserName, names, namesLoaded });
  useEffect(() => {
    latest.current = { messages, currentUserId, currentUserName, names, namesLoaded };
  });
  useEffect(() => {
    const { messages: list, ...who } = latest.current;
    const added = list.slice(announcedCount.current);
    announcedCount.current = list.length;
    const fromOthers = added
      .map((message) => ({ message, sender: senderOf(message, who.currentUserId, who.currentUserName, who.names, who.namesLoaded) }))
      .filter(({ sender }) => sender.kind !== "own");
    if (fromOthers.length === 0) return;
    const text =
      fromOthers.length === 1
        ? `${fromOthers[0].sender.kind === "ai" ? "Choir AI replied" : fromOthers[0].sender.name}: ${spokenPreview(fromOthers[0].message.content)}`
        : `${fromOthers.length} new messages`;
    // A trailing no-break space alternates so the same text is announced again.
    setAnnouncement((previous) => (previous === text ? `${text} ` : text));
  }, [messages.length]);

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottom.current = true;
    setUnseen(0);
  }, []);

  // Start at the latest message.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Follow new content only when the reader is already at the bottom; otherwise count it.
  useLayoutEffect(() => {
    const added = messages.length - lastCount.current;
    lastCount.current = messages.length;
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (added > 0) {
      setUnseen((count) => count + added);
    }
  }, [messages.length, streaming?.text]);

  // Your own message always scrolls into view; onScroll then clears the "new messages" pill.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (scrollToEndSignal === 0 || !el) return;
    el.scrollTop = el.scrollHeight;
    nearBottom.current = true;
  }, [scrollToEndSignal]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const wasNear = nearBottom.current;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom.current && unseen > 0) setUnseen(0);
    if (nearBottom.current !== wasNear) onNearBottomChange?.(nearBottom.current);
  };

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  useLayoutEffect(() => {
    if (pendingScrollAdjust.current === null) return;
    const el = scrollRef.current;
    if (el) el.scrollTop += el.scrollHeight - pendingScrollAdjust.current;
    pendingScrollAdjust.current = null;
  }, [messages]);

  const handleLoadOlder = () => {
    if (scrollRef.current) pendingScrollAdjust.current = scrollRef.current.scrollHeight;
    onLoadOlder?.();
  };

  // "Jump to decision": scroll a specific row into view even when it's not currently
  // rendered (virtualization only mounts what's visible, so a DOM id lookup won't work).
  useEffect(() => {
    if (!highlightedId) return;
    const index = messages.findIndex((m) => m.id === highlightedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {(hasMoreOlder || loadingOlder) && messages.length > 0 && (
        <div className="flex shrink-0 justify-center border-b border-line py-1.5">
          <button
            type="button"
            onClick={handleLoadOlder}
            disabled={loadingOlder}
            className="flex cursor-pointer items-center gap-1.5 rounded-control px-3 py-1 text-caption font-medium text-fg-muted hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingOlder && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
            {loadingOlder ? "Loading older messages…" : "Load older messages"}
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {messages.length === 0 && !streaming ? (
          <div className="flex h-full items-center justify-center">{empty}</div>
        ) : (
          <div className={cn("mx-auto flex w-full max-w-measure flex-col px-4 sm:px-6", compact ? "py-4" : "pb-6 pt-6")}>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index];
                const previous = messages[virtualRow.index - 1];
                const newDay = !previous || dayKey(previous.created_at) !== dayKey(message.created_at);
                const sender = senderOf(message, currentUserId, currentUserName, names, namesLoaded);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {newDay && (
                      <div role="separator" aria-label={formatDayLabel(message.created_at)} className="mb-5 flex items-center gap-3 first:mt-0">
                        <span className="h-px flex-1 bg-line" />
                        <span className="text-caption font-medium text-fg-subtle">{formatDayLabel(message.created_at)}</span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    )}
                    <MessageRow
                      message={message}
                      kind={sender.kind}
                      senderName={sender.name}
                      grouped={!newDay && continuesGroup(previous, message)}
                      canPin={canPin}
                      selectMode={selectMode}
                      selected={selectedIds.has(message.id)}
                      highlighted={highlightedId === message.id}
                      onToggleSelect={onToggleSelect}
                      onTogglePin={onTogglePin}
                      onDiscussPrivately={onDiscussPrivately}
                      seenBy={canPin ? whoHasSeen(message.created_at, message.sender_id, seenBy, names, currentUserId) : undefined}
                    />
                  </div>
                );
              })}
            </div>

            {streaming && (
              <div className="mt-5 flex gap-3" aria-busy="true">
                <Avatar name="Choir AI" kind="ai" size="md" />
                <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                  <div className="flex items-center gap-2 text-caption">
                    <span className="font-semibold text-fg">Choir AI</span>
                    <Badge tone="ai" mono>{streaming.model}</Badge>
                    {streaming.text && (
                      <span className="inline-flex items-center gap-1.5 text-fg-subtle">
                        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-ai" />
                        Writing…
                      </span>
                    )}
                  </div>
                  {streaming.text ? (
                    <div className="text-body text-fg [overflow-wrap:anywhere]">
                      <Markdown>{streaming.text}</Markdown>
                    </div>
                  ) : (
                    <span className="flex h-6 items-center gap-1" role="status">
                      <span className="sr-only">Choir AI is thinking</span>
                      {[0, 150, 300].map((delay) => (
                        <span key={delay} aria-hidden="true" className="size-1.5 animate-typing rounded-full bg-ai" style={{ animationDelay: `${delay}ms` }} />
                      ))}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {unseen > 0 && (
        <button
          type="button"
          onClick={scrollToEnd}
          className="absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 animate-pop cursor-pointer items-center gap-1.5 rounded-full border border-line bg-card px-3.5 text-label font-medium text-fg shadow-raised hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowDown size={14} aria-hidden="true" />
          {unseen} new message{unseen === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
