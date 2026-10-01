"use client";

import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { keepRealtimeAuthFresh } from "@/utils/supabase/realtime-auth";
import type { Task } from "@/types/database";

/**
 * Feature D: a project's task list, kept live for the whole team. As with messages, the login
 * token goes to Realtime before joining, or RLS hides every event. A reconnect re-reads the list,
 * which also catches deletes (DELETE events under RLS carry only the id).
 */
export function useProjectTasks(projectId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const apply = useCallback((row: Task) => {
    setTasks((prev) => (prev.some((t) => t.id === row.id) ? prev.map((t) => (t.id === row.id ? row : t)) : [...prev, row]));
  }, []);
  const remove = useCallback((id: string) => setTasks((prev) => prev.filter((t) => t.id !== id)), []);

  useEffect(() => {
    if (!projectId) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let stop: (() => void) | null = null;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase.from("tasks").select("*").eq("project_id", projectId).order("created_at");
      if (cancelled) return;
      setTasks((data as Task[] | null) ?? []);
      setLoadedFor(projectId);
    };

    void (async () => {
      const auth = await keepRealtimeAuthFresh(supabase);
      stop = auth.stop;
      if (cancelled) return;
      void load();
      let subscribed = false;
      const filter = `project_id=eq.${projectId}`;
      channel = supabase
        .channel(`tasks:${projectId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks", filter }, (p) => apply(p.new as Task))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks", filter }, (p) => apply(p.new as Task))
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (p) => remove((p.old as { id: string }).id))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            if (subscribed) void load();
            subscribed = true;
          }
        });
    })();

    return () => {
      cancelled = true;
      stop?.();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [projectId, apply, remove]);

  const loaded = !!projectId && loadedFor === projectId;
  return { tasks: loaded ? tasks : [], loaded, apply, remove };
}
