"use server";

import { getCurrentUser } from "@/utils/supabase/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { redirect } from "next/navigation";

export async function createTeamSetup(formData: FormData) {
  const teamName = formData.get("teamName")?.toString();
  
  if (!teamName || teamName.trim().length === 0) {
    return { error: "Team name is required." };
  }

  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const adminClient = createAdminClient();

  // 1. Create Team
  const { data: team, error: teamError } = await adminClient
    .from("teams")
    .insert({ name: teamName.trim(), created_by: user.id })
    .select()
    .single();

  if (teamError || !team) {
    return { error: "Failed to create team: " + (teamError?.message || "Unknown error") };
  }

  // 2. Create Team Member (Owner)
  const { error: memberError } = await adminClient
    .from("team_members")
    .insert({ team_id: team.id, user_id: user.id, role: "owner" });

  if (memberError) {
    return { error: "Failed to add as team member: " + memberError.message };
  }

  // 3. Create Default Project
  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({ team_id: team.id, name: "General", created_by: user.id })
    .select()
    .single();

  if (projectError || !project) {
    return { error: "Failed to create project: " + (projectError?.message || "Unknown error") };
  }

  // 4. Create Shared Thread
  const { error: sharedThreadError } = await adminClient
    .from("threads")
    .insert({ project_id: project.id, type: "shared", name: "Team Space" });

  if (sharedThreadError) {
    return { error: "Failed to create shared thread: " + sharedThreadError.message };
  }

  // 5. Create Private Thread for the owner
  const { data: privateThread, error: privateThreadError } = await adminClient
    .from("threads")
    .insert({ project_id: project.id, type: "private", owner_id: user.id, name: "My Scratchpad" })
    .select()
    .single();

  if (privateThreadError || !privateThread) {
    return { error: "Failed to create private thread: " + (privateThreadError?.message || "Unknown error") };
  }

  redirect(`/thread/${privateThread.id}`);
}
