"use client";

import { useCallback, useRef, useState } from "react";
import { loadOlderMessages } from "@/app/(main)/thread/[id]/actions";
import type { Message } from "@/types/database";

// Mirrors utils/supabase/queries.ts's MESSAGE_PAGE_SIZE — kept separate because that
// module pulls in next/headers (server-only) and this hook runs in the browser.
const MESSAGE_PAGE_SIZE = 50;
// Bounds how far back "jump to an older decision" will page before giving up —
// matches the 1,000-message scale C3 is required to handle smoothly.
const JUMP_MAX_PAGES = 20;

/**
 * C3 "Load older": pages further back from `initial` (the newest MESSAGE_PAGE_SIZE
 * messages the page already loaded, oldest first) by a `created_at` cursor.
 */
export function usePagedMessages(threadId: string, initial: Message[]) {
  const [older, setOlder] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(initial.length >= MESSAGE_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  // Mirrors `older` synchronously so loadUntil can check membership without waiting
  // on a state update to land.
  const olderRef = useRef<Message[]>([]);
  const cursor = useRef(initial[0]?.created_at ?? null);
  const hasMoreRef = useRef(hasMore);

  const setOlderBoth = (next: Message[]) => {
    olderRef.current = next;
    setOlder(next);
  };

  const loadOlder = useCallback(async () => {
    if (loading || !hasMoreRef.current || !cursor.current) return;
    setLoading(true);
    const page = await loadOlderMessages(threadId, cursor.current);
    setLoading(false);
    if (page.length === 0) {
      hasMoreRef.current = false;
      setHasMore(false);
      return;
    }
    cursor.current = page[0].created_at;
    if (page.length < MESSAGE_PAGE_SIZE) {
      hasMoreRef.current = false;
      setHasMore(false);
    }
    setOlderBoth([...page, ...olderRef.current]);
  }, [threadId, loading]);

  // Keeps paging back until `messageId` is loaded (or we run out), so "jump to
  // decision" works even for a message older than what's shown yet. Returns whether
  // it was found.
  const loadUntil = useCallback(
    async (messageId: string) => {
      if (initial.some((m) => m.id === messageId) || olderRef.current.some((m) => m.id === messageId)) return true;
      for (let i = 0; i < JUMP_MAX_PAGES && hasMoreRef.current && cursor.current; i++) {
        const page = await loadOlderMessages(threadId, cursor.current);
        if (page.length === 0) {
          hasMoreRef.current = false;
          setHasMore(false);
          return false;
        }
        cursor.current = page[0].created_at;
        if (page.length < MESSAGE_PAGE_SIZE) {
          hasMoreRef.current = false;
          setHasMore(false);
        }
        setOlderBoth([...page, ...olderRef.current]);
        if (page.some((m) => m.id === messageId)) return true;
      }
      return false;
    },
    [threadId, initial]
  );

  return { older, hasMore, loading, loadOlder, loadUntil };
}
