import { cache } from "react";
import { createClient } from "./server";
import type { Message, Project, Team, Thread } from "@/types/database";

export interface Workspace {
  teams: Team[];
  projects: Project[];
  threads: Thread[];
}

const EMPTY_WORKSPACE: Workspace = { teams: [], projects: [], threads: [] };

export const getWorkspace = cache(async (userId: string): Promise<Workspace> => {
  const supabase = await createClient();

  const { data: memberships, error: membershipError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);
  if (membershipError) {
    console.error("Error fetching team memberships:", membershipError);
    return EMPTY_WORKSPACE;
  }

  const teamIds = (memberships ?? []).map((m) => m.team_id as string);
  if (teamIds.length === 0) return EMPTY_WORKSPACE;

  const [teamsResult, projectsResult] = await Promise.all([
    supabase.from("teams").select("*").in("id", teamIds).order("created_at", { ascending: true }),
    supabase.from("projects").select("*").in("team_id", teamIds).order("created_at", { ascending: true }),
  ]);
  if (teamsResult.error || projectsResult.error) {
    console.error("Error fetching workspace:", teamsResult.error ?? projectsResult.error);
    return EMPTY_WORKSPACE;
  }

  const teams = teamsResult.data as Team[];
  const projects = projectsResult.data as Project[];
  if (projects.length === 0) return { teams, projects, threads: [] };

  const { data: threads, error: threadsError } = await supabase
    .from("threads")
    .select("*")
    .in("project_id", projects.map((p) => p.id))
    .or(`type.eq.shared,owner_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (threadsError) {
    console.error("Error fetching threads:", threadsError);
    return { teams, projects, threads: [] };
  }

  return { teams, projects, threads: threads as Thread[] };
});

export async function getSharedThread(projectId: string): Promise<Thread | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", "shared")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error fetching shared thread:", error);
    return null;
  }
  return data as Thread | null;
}

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
