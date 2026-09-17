"use server";

import { createClient } from "@/utils/supabase/server";
import { getWorkspace } from "@/utils/supabase/queries";
import { getCurrentUser } from "@/utils/supabase/access";
import { getTeamMemberNames } from "@/utils/supabase/member-names";
import { getDisplayName } from "@/utils/display-name";

export interface GlobalSearchThread {
  id: string;
  name: string | null;
  type: string;
}

export interface GlobalSearchMessage {
  id: string;
  content: string;
  created_at: string;
  sender_type: "user" | "assistant";
  sender_id: string | null;
  /** Who wrote it: "Choir AI", a teammate's name, or "Former member". */
  sender_name: string;
  // A `!inner` join on a to-one FK always returns a single row, not an array —
  // Supabase's select-string type inference can't tell that apart from a
  // to-many relation without generated DB types, so this is asserted below.
  threads: GlobalSearchThread;
}

export interface GlobalSearchResult {
  threads: GlobalSearchThread[];
  messages: GlobalSearchMessage[];
  error?: string;
}

export async function globalSearch(query: string): Promise<GlobalSearchResult> {
  if (!query || query.trim().length < 2) return { threads: [], messages: [] };

  const user = await getCurrentUser();
  if (!user) return { threads: [], messages: [], error: "Unauthorized" };

  const { threads: accessibleThreads, projects } = await getWorkspace(user.id);
  const threadIds = accessibleThreads.map((t) => t.id);
  if (threadIds.length === 0) return { threads: [], messages: [] };

  const supabase = await createClient();

  const { data: threads } = await supabase
    .from("threads")
    .select("id, name, type")
    .in("id", threadIds)
    .ilike("name", `%${query}%`)
    .limit(5);

  const { data: messages } = await supabase
    .from("messages")
    .select(`
      id,
      content,
      created_at,
      sender_type,
      sender_id,
      thread_id,
      threads!inner (
        id,
        name,
        type
      )
    `)
    .in("thread_id", threadIds)
    .ilike("content", `%${query}%`)
    .limit(10);

  const rows = (messages as unknown as (Omit<GlobalSearchMessage, "sender_name"> & { thread_id: string })[] | null) || [];

  // Names only for the teams these results belong to (all of them the user's own teams).
  const teamOfThread = new Map(
    accessibleThreads.map((t) => [t.id, projects.find((p) => p.id === t.project_id)?.team_id])
  );
  const teamIds = [...new Set(rows.map((m) => teamOfThread.get(m.thread_id)).filter((id): id is string => !!id))];
  const names: Record<string, string> = Object.assign(
    {},
    ...(await Promise.all(teamIds.map((id) => getTeamMemberNames(id))))
  );
  names[user.id] = getDisplayName(user);

  return {
    threads: (threads as GlobalSearchThread[] | null) || [],
    messages: rows.map(({ thread_id: _threadId, ...m }) => ({
      ...m,
      sender_name: m.sender_type === "assistant" ? "Choir AI" : names[m.sender_id ?? ""] ?? "Former member",
    })),
  };
}
