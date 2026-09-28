"use server";

import { createClient } from "@/utils/supabase/server";
import { getCurrentUser } from "@/utils/supabase/access";
import { getTeamMemberNames } from "@/utils/supabase/member-names";
import { getDisplayName } from "@/utils/display-name";
import { revalidatePath } from "next/cache";

const MAX_TEAM_NAME_LENGTH = 80;
const DATABASE_UPDATE_PENDING = "This needs a database update that hasn't been applied yet. Please try again later.";

// Any team member can rename it (schema.sql: "Team members can rename their teams").
// PostgREST silently drops a disallowed column from an update instead of erroring,
// so a rename that didn't actually take effect looks like success unless checked.
export async function renameTeam(teamId: string, name: string): Promise<{ success?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the team a name." };
  if (trimmed.length > MAX_TEAM_NAME_LENGTH) {
    return { error: `Keep the name under ${MAX_TEAM_NAME_LENGTH} characters.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("teams").update({ name: trimmed }).eq("id", teamId).select("id, name");

  if (error?.code === "42703" || error?.code === "PGRST204") {
    console.error("Error renaming team (database update pending):", error);
    return { error: DATABASE_UPDATE_PENDING };
  }
  if (error) {
    console.error("Error renaming team:", error);
    return { error: "Couldn't rename the team. Please try again." };
  }
  if (!data || data.length === 0 || data[0].name !== trimmed) {
    console.error("Rename didn't take effect (likely teams.name's update grant/RLS policy isn't applied yet):", data);
    return { error: DATABASE_UPDATE_PENDING };
  }

  // Same pattern as updateDisplayName (profile/actions.ts): the root layout reads
  // team names once per request, so a rename needs the layout's data explicitly
  // revalidated — the client's router.refresh() alone wasn't reflecting it.
  revalidatePath("/", "layout");
  return { success: true };
}

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

  const supabase = await createClient();

  // RLS (can_access_thread) already scopes both tables to what this user can see,
  // so search doesn't need its own copy of that access check — reusing a second,
  // client-side computation of "accessible threads" here previously drifted out of
  // sync with the real RLS rule and hid results it shouldn't have.
  const { data: threads } = await supabase
    .from("threads")
    .select("id, name, type")
    .ilike("name", `%${query}%`)
    .limit(5);

  // `messages` has two FKs to `threads` (thread_id and K2's source_thread_id), so the
  // embed needs the thread_id hint — plain `threads!inner(...)` is ambiguous and
  // PostgREST errors, which this was silently swallowing (error never checked below).
  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select(`
      id,
      content,
      created_at,
      sender_type,
      sender_id,
      thread_id,
      threads!thread_id!inner (
        id,
        name,
        type
      )
    `)
    .ilike("content", `%${query}%`)
    .limit(10);
  if (messagesError) console.error("globalSearch messages query failed:", messagesError);

  const rows = (messages as unknown as (Omit<GlobalSearchMessage, "sender_name"> & { thread_id: string })[] | null) || [];

  // Names only for the teams these results belong to. Looked up directly from the
  // (RLS-scoped) thread/project rows rather than getWorkspace's list, so a result
  // never shows "Former member" just because that list didn't happen to include it.
  const resultThreadIds = [...new Set(rows.map((m) => m.thread_id))];
  const { data: resultThreads } = resultThreadIds.length
    ? await supabase.from("threads").select("id, project_id").in("id", resultThreadIds)
    : { data: [] as { id: string; project_id: string }[] };
  const projectIds = [...new Set((resultThreads ?? []).map((t) => t.project_id))];
  const { data: resultProjects } = projectIds.length
    ? await supabase.from("projects").select("id, team_id").in("id", projectIds)
    : { data: [] as { id: string; team_id: string }[] };
  const teamOfProject = new Map((resultProjects ?? []).map((p) => [p.id, p.team_id]));
  const teamOfThread = new Map(
    (resultThreads ?? []).map((t) => [t.id, teamOfProject.get(t.project_id)])
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
