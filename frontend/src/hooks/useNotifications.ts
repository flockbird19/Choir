"use client";

import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

/** A row of `notifications`. kind 'key_rate_limited' has payload {provider, project_name, thread_id}. */
export interface AppNotification {
  id: string;
  user_id: string;
  team_id?: string | null;
  project_id?: string | null;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at?: string | null;
}

const LIMIT = 20;

function upsert(list: AppNotification[], row: AppNotification) {
  const rest = list.filter((n) => n.id !== row.id);
  return [row, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, LIMIT);
}

/**
 * The signed-in user's latest notifications, kept live with a realtime subscription.
 * As in useRealtimeMessages, the login token is handed to Realtime before joining;
 * otherwise the channel joins as the anonymous role and RLS hides every event.
 */
export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const load = async (userId: string) => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (cancelled) return;
      setItems((data as AppNotification[] | null) ?? []);
      setLoaded(true);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session) return;
      const userId = session.user.id;
      await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;
      void load(userId);

      let hasSubscribed = false;
      const onRow = (payload: { new: unknown }) => {
        const row = payload.new as AppNotification;
        if (row?.id) setItems((prev) => upsert(prev, row));
      };
      channel = supabase
        .channel(`notifications:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onRow)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onRow)
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            // After a dropped connection, pick up anything that arrived meanwhile.
            if (hasSubscribed) void load(userId);
            hasSubscribed = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error(`Live notifications failed (${status})`, err);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const readAt = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? readAt } : n)));
    const { error } = await createClient().from("notifications").update({ read_at: readAt }).in("id", ids);
    if (error) {
      console.error("Could not mark notifications read", error);
      setItems((prev) => prev.map((n) => (ids.includes(n.id) && n.read_at === readAt ? { ...n, read_at: null } : n)));
    }
  }, []);

  const unread = items.filter((n) => !n.read_at);
  return { items, loaded, unreadCount: unread.length, unreadIds: unread.map((n) => n.id), markRead };
}
