"use client";

import { useCallback, useEffect, useState } from "react";
import { getThreadDecisions } from "@/app/(main)/thread/[id]/actions";
import type { Message } from "@/types/database";

/**
 * C3: Decisions are shown regardless of how far "load older" has paged back, so
 * they're fetched on their own instead of filtered out of the loaded message page.
 * `applyUpdate` folds in a realtime pin/unpin UPDATE event (or an optimistic one).
 */
export function useThreadDecisions(threadId: string | null | undefined) {
  const [decisions, setDecisions] = useState<Message[]>([]);

  useEffect(() => {
    if (!threadId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDecisions([]);
      return;
    }
    let cancelled = false;
    getThreadDecisions(threadId).then((data) => {
      if (!cancelled) setDecisions(data);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const applyUpdate = useCallback((message: Message) => {
    setDecisions((prev) => {
      if (!message.is_decision) return prev.filter((m) => m.id !== message.id);
      return prev.some((m) => m.id === message.id)
        ? prev.map((m) => (m.id === message.id ? { ...m, ...message } : m))
        : [...prev, message];
    });
  }, []);

  return { decisions, applyUpdate };
}
