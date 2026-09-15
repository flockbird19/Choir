import { cache } from "react";
import { createClient } from "./server";
import type { Message, Project, Team, Thread } from "@/types/database";

export interface Workspace {
  teams: Team[];
  projects: Project[];
  threads: Thread[];
}

const EMPTY_WORKSPACE: Workspace = { teams: [], projects: [], threads: [] };

type WorkspaceRow = { teams: (Team & { projects: (Project & { threads: Thread[] })[] }) | null };

// One round trip: the user's memberships with their teams, projects and the threads
// they may open (shared threads, plus their own private threads).
export const getWorkspace = cache(async (userId: string): Promise<Workspace> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("teams!inner(*, projects(*, threads(*)))")
    .eq("user_id", userId)
    .or(`type.eq.shared,owner_id.eq.${userId}`, { referencedTable: "teams.projects.threads" });
  if (error) {
    console.error("Error fetching workspace:", error);
    return EMPTY_WORKSPACE;
  }

  const byCreated = <T extends { created_at: string }>(a: T, b: T) => a.created_at.localeCompare(b.created_at);
  const rows = (data ?? []) as unknown as WorkspaceRow[];
  const nestedTeams = rows.flatMap((row) => (row.teams ? [row.teams] : [])).sort(byCreated);
  const nestedProjects = nestedTeams.flatMap((team) => team.projects ?? []).sort(byCreated);

  return {
    teams: nestedTeams.map(({ projects: _projects, ...team }) => team),
    projects: nestedProjects.map(({ threads: _threads, ...project }) => project),
    threads: nestedProjects.flatMap((project) => project.threads ?? []).sort((a, b) => byCreated(b, a)),
  };
});

// Callers must check access first with getAccessibleThread (access.ts).
export async function getMessages(threadId: string): Promise<Message[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching messages:", error);
    return [];
  }
  return data as Message[];
}
