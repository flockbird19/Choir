"use client";

import { useEffect, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

export interface PresentUser {
  id: string;
  name: string;
}

/**
 * Tracks who else currently has a given thread open, via Supabase Realtime Presence.
 * Presence state is ephemeral (in-memory on Supabase's side) — nothing is persisted.
 * Resolves the current user from the browser session itself, so callers don't need
 * to thread user info down as props.
 */
export function useThreadPresence(threadId: string | null | undefined): PresentUser[] {
  const [others, setOthers] = useState<PresentUser[]>([]);

  useEffect(() => {
    if (!threadId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOthers([]);
      return;
    }

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      const selfId = session.user.id;
      const selfName =
        session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "User";

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
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel!.track({ name: selfName });
        }
      });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [threadId]);

  return others;
}
