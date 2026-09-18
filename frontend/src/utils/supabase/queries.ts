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

// C3: initial load is capped so opening a long thread doesn't render its whole
// history; "load older" (getMessagesBefore) pages further back on demand.
export const MESSAGE_PAGE_SIZE = 50;

// Callers must check access first with getAccessibleThread (access.ts). Returns the
// most recent `limit` messages, oldest first (uses the messages(thread_id, created_at) index).
export async function getMessages(threadId: string, limit = MESSAGE_PAGE_SIZE): Promise<Message[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching messages:", error);
    return [];
  }
  return (data as Message[]).reverse();
}

// C3 "Load older": the `limit` messages immediately before a `created_at` cursor,
// oldest first. ponytail: a plain created_at cursor can in theory skip a same-instant
// duplicate; add an id tiebreaker if that ever shows up in practice.
export async function getMessagesBefore(
  threadId: string,
  beforeCreatedAt: string,
  limit = MESSAGE_PAGE_SIZE
): Promise<Message[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching older messages:", error);
    return [];
  }
  return (data as Message[]).reverse();
}

// C3: Decisions are shown regardless of how far back pagination has loaded, so they
// need their own always-fetch-everything query rather than filtering the loaded page.
export async function getDecisions(threadId: string): Promise<Message[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("is_decision", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching decisions:", error);
    return [];
  }
  return data as Message[];
}
