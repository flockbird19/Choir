"use client";

import { useEffect, useId, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { keepRealtimeAuthFresh } from "@/utils/supabase/realtime-auth";
import type { StatusId } from "@/app/(main)/profile/actions";

export const STATUS_LABEL: Record<StatusId, string> = {
  online: "online",
  away: "away",
  dnd: "do not disturb",
  offline: "offline",
};

// DESIGN.md doesn't have a palette of its own yet for presence status (§3.2 only
// covers team/private/decision/danger/success), so this reuses those already-checked
// hexes rather than inventing new, unvetted colours. Each pair passes WCAG 3:1 against
// both bg and card in light and dark (checked against DESIGN.md §3.5's own numbers,
// since these are the same "strong" tokens used there as 4.5:1 text colours).
export const STATUS_DOT_CLASS: Record<StatusId, string> = {
  online: "bg-[#1B7A4D] dark:bg-[#4CC38A]",
  away: "bg-[#8F5405] dark:bg-[#E9A94B]",
  dnd: "bg-[#C2362B] dark:bg-[#F07167]",
  offline: "bg-[#686C78] dark:bg-[#8D919E]",
};

function normalizeStatus(status: string | null | undefined): StatusId {
  return status === "away" || status === "dnd" || status === "offline" ? status : "online";
}

/**
 * Everyone's profile status (self + teammates, per the `profiles` row-level security)
 * kept live over Realtime, so a status change shows up without a refresh. As in
 * useRealtimeMessages and useNotifications, the login token is handed to Realtime
 * before subscribing — otherwise the channel joins as the anonymous role and RLS
 * hides every event.
 */
export function useTeammateStatuses(): Record<string, StatusId> {
  const [statuses, setStatuses] = useState<Record<string, StatusId>>({});
  // createBrowserClient (and so its Realtime socket) is a singleton per tab, so two
  // components mounting this hook at once (e.g. the sidebar and the open thread) would
  // otherwise both try to subscribe the same fixed topic — the second `.on()` call
  // then fails because the channel is already joined. A per-instance id keeps them apart.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let stopAuthRefresh: (() => void) | null = null;
    let cancelled = false;

    const refresh = async () => {
      const { data } = await supabase.from("profiles").select("id, status");
      if (cancelled || !data) return;
      const next: Record<string, StatusId> = {};
      for (const row of data as { id: string; status: string | null }[]) {
        next[row.id] = normalizeStatus(row.status);
      }
      setStatuses(next);
    };

    (async () => {
      const { session, stop } = await keepRealtimeAuthFresh(supabase);
      stopAuthRefresh = stop;
      if (cancelled || !session) return;

      void refresh();

      let hasSubscribed = false;
      channel = supabase
        .channel(`profiles:statuses:${instanceId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
          const row = payload.new as { id?: string; status?: string | null };
          if (row?.id) setStatuses((prev) => ({ ...prev, [row.id!]: normalizeStatus(row.status) }));
        })
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            // After a dropped connection, pick up anything that changed meanwhile.
            if (hasSubscribed) void refresh();
            hasSubscribed = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error(`Live status updates failed (${status})`, err);
          }
        });
    })();

    return () => {
      cancelled = true;
      stopAuthRefresh?.();
      if (channel) supabase.removeChannel(channel);
    };
  }, [instanceId]);

  return statuses;
}
