"use client";

import { useEffect, useRef, useState } from "react";
import { getThreadSeenBy, markThreadSeen } from "@/app/(main)/thread/[id]/actions";

// "At most once every few seconds" per the E5 spec, not on every scroll event.
const MARK_THROTTLE_MS = 5000;
// How often we check whether teammates have caught up. Not realtime (their own read
// position is private under RLS, see getThreadSeenBy), so a short poll stands in.
const POLL_MS = 20000;

/**
 * E5 "Seen by": while `atBottom` is true, marks the shared thread read for the current
 * user (throttled) and returns teammates' last-read times so the UI can show who has
 * seen which messages. Pass `enabled=false` outside shared threads.
 */
export function useSeenBy(
  threadId: string | null | undefined,
  atBottom: boolean,
  enabled: boolean
): Record<string, string> {
  const [seenBy, setSeenBy] = useState<Record<string, string>>({});
  const atBottomRef = useRef(atBottom);
  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  useEffect(() => {
    if (!enabled || !threadId) return;
    let cancelled = false;

    const refreshSeenBy = () => {
      getThreadSeenBy(threadId).then((data) => {
        if (!cancelled) setSeenBy(data);
      });
    };
    const markIfAtBottom = () => {
      if (atBottomRef.current) void markThreadSeen(threadId);
    };

    refreshSeenBy();
    markIfAtBottom();
    const markTimer = setInterval(markIfAtBottom, MARK_THROTTLE_MS);
    const pollTimer = setInterval(refreshSeenBy, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(markTimer);
      clearInterval(pollTimer);
    };
  }, [threadId, enabled]);

  return seenBy;
}

/** Teammates (never the sender or the viewer) whose last-read time is at or after `createdAt`. */
export function whoHasSeen(
  createdAt: string,
  senderId: string | null | undefined,
  seenBy: Record<string, string>,
  names: Record<string, string>,
  currentUserId: string
): { id: string; name: string }[] {
  const at = Date.parse(createdAt);
  return Object.entries(seenBy)
    .filter(([userId, lastReadAt]) => userId !== senderId && userId !== currentUserId && Date.parse(lastReadAt) >= at)
    .map(([userId]) => ({ id: userId, name: names[userId] ?? "Teammate" }));
}
