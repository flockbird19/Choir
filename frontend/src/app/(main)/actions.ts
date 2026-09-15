"use server";

import { createClient } from "@/utils/supabase/server";
import { getWorkspace } from "@/utils/supabase/queries";
import { getCurrentUser } from "@/utils/supabase/access";

export interface GlobalSearchThread {
  id: string;
  name: string | null;
  type: string;
}

export interface GlobalSearchMessage {
  id: string;
  content: string;
  created_at: string;
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

  const { threads: accessibleThreads } = await getWorkspace(user.id);
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
      threads!inner (
        id,
        name,
        type
      )
    `)
    .in("thread_id", threadIds)
    .ilike("content", `%${query}%`)
    .limit(10);

  return {
    threads: (threads as GlobalSearchThread[] | null) || [],
    messages: (messages as unknown as GlobalSearchMessage[] | null) || [],
  };
}
