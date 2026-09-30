"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

export interface PresentUser {
  id: string;
  name: string;
}

// A "typing" ping is re-sent at most this often while someone keeps typing, and a
// teammate's indicator clears if no ping arrives within TYPING_EXPIRE_MS.
const TYPING_RESEND_MS = 2000;
const TYPING_EXPIRE_MS = 4500;

/**
 * Tracks who else currently has a given thread open, via Supabase Realtime Presence,
 * and who of them is typing, via broadcast pings on the same channel.
 * Both are ephemeral (in-memory on Supabase's side) — nothing is persisted.
 * `selfName` comes from the server: the browser session token can hold a stale name.
 */
export function useThreadPresence(threadId: string | null | undefined, selfName: string) {
  const [others, setOthers] = useState<PresentUser[]>([]);
  const [typing, setTypingUsers] = useState<PresentUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!threadId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOthers([]);
      setTypingUsers([]);
      return;
    }

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    const expiry = new Map<string, ReturnType<typeof setTimeout>>();

    const stopShowing = (id: string) => {
      clearTimeout(expiry.get(id));
      expiry.delete(id);
      setTypingUsers((prev) => prev.filter((u) => u.id !== id));
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      const selfId = session.user.id;
      selfIdRef.current = selfId;

      channel = supabase.channel(`presence:${threadId}`, {
        config: { presence: { key: selfId } },
      });

      channel.on("presence", { event: "sync" }, () => {
        const state = channel!.presenceState<{ name: string }>();
        const list: PresentUser[] = [];
        for (const key of Object.keys(state)) {
          if (key === selfId) continue;
          const entry = state[key]?.[0];
          if (entry) list.push({ id: key, name: entry.name });
        }
        setOthers(list);
        // Someone who closed the thread mid-sentence isn't typing any more.
        for (const id of expiry.keys()) if (!state[id]) stopShowing(id);
      });

      channel.on("broadcast", { event: "typing" }, ({ payload }) => {
        const { id, name, typing: isTyping } = (payload ?? {}) as { id?: string; name?: string; typing?: boolean };
        if (!id || id === selfId) return;
        if (!isTyping) return stopShowing(id);
        clearTimeout(expiry.get(id));
        expiry.set(id, setTimeout(() => stopShowing(id), TYPING_EXPIRE_MS));
        setTypingUsers((prev) => (prev.some((u) => u.id === id) ? prev : [...prev, { id, name: name || "A teammate" }]));
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          channelRef.current = channel;
          await channel!.track({ name: selfName });
        }
      });
    })();

    return () => {
      cancelled = true;
      for (const t of expiry.values()) clearTimeout(t);
      channelRef.current = null;
      lastSentRef.current = 0;
      if (channel) supabase.removeChannel(channel);
    };
  }, [threadId, selfName]);

  /** Call on every keystroke (true) and on send or clear (false). Throttled. */
  const setTyping = useCallback(
    (isTyping: boolean) => {
      const channel = channelRef.current;
      if (!channel || !selfIdRef.current) return;
      const now = Date.now();
      if (isTyping && now - lastSentRef.current < TYPING_RESEND_MS) return;
      if (!isTyping && lastSentRef.current === 0) return; // Nothing to take back.
      lastSentRef.current = isTyping ? now : 0;
      void channel.send({
        type: "broadcast",
        event: "typing",
        payload: { id: selfIdRef.current, name: selfName, typing: isTyping },
      });
    },
    [selfName]
  );

  return { others, typing, setTyping };
}
