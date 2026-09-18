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
  enabled: boolean,
  /** `created_at` of the newest message. Nothing new to mark means nothing is written. */
  latestMessageAt?: string | null
): Record<string, string> {
  const [seenBy, setSeenBy] = useState<Record<string, string>>({});
  const atBottomRef = useRef(atBottom);
  const latestRef = useRef(latestMessageAt);
  // What we last told the server we had read, so an idle tab stops writing.
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    atBottomRef.current = atBottom;
    latestRef.current = latestMessageAt;
  }, [atBottom, latestMessageAt]);

  useEffect(() => {
    if (!enabled || !threadId) return;
    let cancelled = false;

    // These run on a timer forever, so a failure must never become an unhandled
    // rejection — that turned one hiccup into a console error every few seconds.
    const refreshSeenBy = () => {
      getThreadSeenBy(threadId)
        .then((data) => {
          if (!cancelled) setSeenBy(data);
        })
        .catch(() => {
          // Offline, or the session is being refreshed. The next tick will retry.
        });
    };
    const markIfAtBottom = () => {
      const latest = latestRef.current;
      // Only write when we are at the bottom AND there is something newer than
      // what we already marked. An idle tab used to write every 5 seconds.
      if (!atBottomRef.current || !latest || latest === markedRef.current) return;
      markedRef.current = latest;
      markThreadSeen(threadId).catch(() => {
        // Let the next tick try again rather than losing the position for good.
        markedRef.current = null;
      });
    };

    markedRef.current = null;
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
