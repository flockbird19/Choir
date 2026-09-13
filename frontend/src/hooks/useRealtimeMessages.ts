"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/utils/supabase/client";
import { Message } from "@/types/database";

/**
 * Subscribes to live INSERT/UPDATE events on `messages` for a given thread and
 * forwards each row to the caller. INSERT covers new messages arriving from other
 * clients; UPDATE covers pin/unpin (`is_decision`) changes so the Decisions panel
 * stays in sync across everyone viewing the thread.
 */
export function useRealtimeMessages(
  threadId: string | null | undefined,
  onInsert: (message: Message) => void,
  onUpdate: (message: Message) => void
) {
  // Keep the latest callbacks in refs so the effect doesn't need to re-subscribe
  // just because the parent re-rendered with new (but equivalent) closures.
  const onInsertRef = useRef(onInsert);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onInsertRef.current = onInsert;
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (!threadId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`messages:${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        (payload) => onInsertRef.current(payload.new as Message)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        (payload) => onUpdateRef.current(payload.new as Message)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);
}
