"use server";

import { createClient } from "@/utils/supabase/server";
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
  sender_type: "user" | "assistant" | "agent";
  sender_id: string | null;
  via_client?: string | null;
  /** Who wrote it: "Choir AI", a teammate's name, "Claude Code (Priya's agent)", or "Former member". */
  sender_name: string;
  // A `!inner` join on a to-one FK always returns a single row, not an array —
  // Supabase's select-string type inference can't tell that apart from a
  // to-many relation without generated DB types, so this is asserted below.
  threads: GlobalSearchThread;
}

/** Feature D: a task whose title matches; opening it shows its project's Team Space with Tasks open. */
export interface GlobalSearchTask {
  id: string;
  title: string;
  status: "open" | "claimed" | "done";
  shared_thread_id: string;
}

export interface GlobalSearchResult {
  threads: GlobalSearchThread[];
  messages: GlobalSearchMessage[];
  tasks: GlobalSearchTask[];
  error?: string;
}

export async function globalSearch(query: string): Promise<GlobalSearchResult> {
  if (!query || query.trim().length < 2) return { threads: [], messages: [], tasks: [] };

  const user = await getCurrentUser();
  if (!user) return { threads: [], messages: [], tasks: [], error: "Unauthorized" };

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
      via_client,
      thread_id,
      threads!thread_id!inner (
        id,
        name,
        type
      )
    `)
    .ilike("content", `%${query}%`)
    // Component #4: compact cards are AI summaries, not something anyone said.
    .neq("kind", "checkpoint")
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

  // Feature D: tasks by title (RLS: your teams' projects only), each opening its Team Space.
  const { data: taskRows } = await supabase
    .from("tasks")
    .select("id, title, status, project_id")
    .ilike("title", `%${query}%`)
    .limit(5);
  const taskProjects = [...new Set((taskRows ?? []).map((t) => t.project_id as string))];
  const { data: taskShared } = taskProjects.length
    ? await supabase.from("threads").select("id, project_id").eq("type", "shared").in("project_id", taskProjects)
    : { data: [] as { id: string; project_id: string }[] };
  const sharedOf = new Map((taskShared ?? []).map((t) => [t.project_id, t.id]));
  const tasks = (taskRows ?? []).flatMap((t) => {
    const shared = sharedOf.get(t.project_id as string);
    return shared ? [{ id: t.id as string, title: t.title as string, status: t.status as GlobalSearchTask["status"], shared_thread_id: shared }] : [];
  });

  return {
    tasks,
    threads: (threads as GlobalSearchThread[] | null) || [],
    messages: rows.map(({ thread_id: _threadId, ...m }) => ({
      ...m,
      sender_name:
        m.sender_type === "assistant"
          ? "Choir AI"
          : m.sender_type === "agent"
            ? `${m.via_client || "Coding agent"} (${names[m.sender_id ?? ""] ?? "a former member"}’s agent)`
            : names[m.sender_id ?? ""] ?? "Former member",
    })),
  };
}
