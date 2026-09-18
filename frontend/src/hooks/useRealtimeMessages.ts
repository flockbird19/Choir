"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { keepRealtimeAuthFresh } from "@/utils/supabase/realtime-auth";
import { Message } from "@/types/database";

/**
 * Subscribes to live INSERT/UPDATE events on `messages` for a given thread and
 * forwards each row to the caller. INSERT covers new messages arriving from other
 * clients; UPDATE covers pin/unpin (`is_decision`) changes so the Decisions panel
 * stays in sync across everyone viewing the thread.
 *
 * The login token is handed to Realtime before joining. Otherwise the channel can
 * join before supabase-js has loaded the session, as the anonymous role, and RLS
 * on `messages` then filters out every event.
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
    let channel: RealtimeChannel | null = null;
    let stopAuthRefresh: (() => void) | null = null;
    let cancelled = false;
    let hasSubscribed = false;

    // After a dropped connection, pick up anything sent while we were away.
    const catchUp = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled || !data) return;
      for (const message of [...data].reverse()) onInsertRef.current(message as Message);
    };

    (async () => {
      const { stop } = await keepRealtimeAuthFresh(supabase);
      stopAuthRefresh = stop;
      if (cancelled) return;

      channel = supabase
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
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            if (hasSubscribed) void catchUp();
            hasSubscribed = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error(`Live updates for thread ${threadId} failed (${status})`, err);
          }
        });
    })();

    return () => {
      cancelled = true;
      stopAuthRefresh?.();
      if (channel) supabase.removeChannel(channel);
    };
  }, [threadId]);
}
