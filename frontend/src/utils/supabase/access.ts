import { cache } from "react";
import { createClient } from "./server";
import type { Thread } from "@/types/database";

export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const isTeamMember = cache(async (userId: string, teamId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
});

// Must stay in sync with verify_thread_access in backend/src/backend/db.py.
export const getAccessibleThread = cache(
  async (userId: string, threadId: string): Promise<Thread | null> => {
    const supabase = await createClient();
    const { data: thread } = await supabase
      .from("threads")
      .select("*")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread) return null;

    if (thread.type === "private") {
      return thread.owner_id === userId ? (thread as Thread) : null;
    }

    const { data: project } = await supabase
      .from("projects")
      .select("team_id")
      .eq("id", thread.project_id)
      .maybeSingle();
    if (!project) return null;

    return (await isTeamMember(userId, project.team_id)) ? (thread as Thread) : null;
  }
);
