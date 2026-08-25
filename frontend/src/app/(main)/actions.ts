"use server";

import { createClient } from "@/utils/supabase/server";

export async function globalSearch(query: string) {
  if (!query || query.trim().length < 2) return { threads: [], messages: [] };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // Search Threads
  const { data: threads } = await supabase
    .from("threads")
    .select("id, name, type")
    .ilike("name", `%${query}%`)
    .limit(5);

  // Search Messages
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
    .ilike("content", `%${query}%`)
    .limit(10);

  return { threads: threads || [], messages: messages || [] };
}
