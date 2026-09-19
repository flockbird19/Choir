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

// Presence has its own palette (--ds-presence-*, see DESIGN.md 3.6) rather than borrowing
// the private / decision / danger meaning colours: DESIGN.md 3.2 forbids using a meaning
// colour for something that does not carry that meaning, and 'this person is around' is
// not the same idea as 'this thread is private'. Each pair clears WCAG 3:1 against every
// surface a dot can sit on, in both themes.
//
// The four statuses sit close together in luminance, so a dot must never be the only
// signal. Every place that renders one also exposes STATUS_LABEL as text.
export const STATUS_DOT_CLASS: Record<StatusId, string> = {
  online: "bg-presence-online",
  away: "bg-presence-away",
  dnd: "bg-presence-dnd",
  offline: "bg-presence-offline",
};

/** Ring colour for the selected option in the profile status picker. */
export const STATUS_RING_CLASS: Record<StatusId, string> = {
  online: "ring-presence-online",
  away: "ring-presence-away",
  dnd: "ring-presence-dnd",
  offline: "ring-presence-offline",
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
