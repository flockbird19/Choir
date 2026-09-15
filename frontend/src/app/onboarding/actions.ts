"use server";

import { getCurrentUser } from "@/utils/supabase/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { siteOrigin } from "@/utils/site-origin";

export type WorkspaceSetupResult =
  | { error: string }
  | { teamName: string; inviteLink: string; sharedThreadId: string };

const MAX_TEAM_NAME_LENGTH = 80;

// Creates everything a new team needs in one go — team, owner membership, project,
// shared "Team Space", private "My Scratchpad" and an invite link — so the owner can
// share the link from the same screen. If any step fails the team is deleted again
// (the rest cascades), so nobody is left with a half-built workspace.
export async function createWorkspace(formData: FormData): Promise<WorkspaceSetupResult> {
  const teamName = formData.get("teamName")?.toString().trim() ?? "";
  if (!teamName) return { error: "Give your team a name." };
  if (teamName.length > MAX_TEAM_NAME_LENGTH) {
    return { error: `Keep the team name under ${MAX_TEAM_NAME_LENGTH} characters.` };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Your session has ended. Sign in again to continue." };

  const admin = createAdminClient();

  const { data: team, error: teamError } = await admin
    .from("teams")
    .insert({ name: teamName, created_by: user.id })
    .select("id")
    .single();
  if (teamError || !team) {
    console.error("Workspace setup: team insert failed", teamError);
    return { error: "We couldn't create your workspace. Please try again." };
  }

  const fail = async (step: string, cause: unknown): Promise<WorkspaceSetupResult> => {
    console.error(`Workspace setup: ${step} failed`, cause);
    const { error: cleanupError } = await admin.from("teams").delete().eq("id", team.id);
    if (cleanupError) console.error("Workspace setup: cleanup failed", cleanupError);
    return { error: "We couldn't finish setting up your workspace. Please try again." };
  };

  const { error: memberError } = await admin
    .from("team_members")
    .insert({ team_id: team.id, user_id: user.id, role: "owner" });
  if (memberError) return fail("owner membership", memberError);

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({ team_id: team.id, name: "General", created_by: user.id })
    .select("id")
    .single();
  if (projectError || !project) return fail("project", projectError);

  const [sharedResult, privateResult, inviteResult] = await Promise.all([
    admin
      .from("threads")
      .insert({ project_id: project.id, type: "shared", name: "Team Space" })
      .select("id")
      .single(),
    admin
      .from("threads")
      .insert({ project_id: project.id, type: "private", owner_id: user.id, name: "My Scratchpad" })
      .select("id")
      .single(),
    admin
      .from("team_invitations")
      .insert({ team_id: team.id, created_by: user.id })
      .select("token")
      .single(),
  ]);

  if (sharedResult.error || !sharedResult.data) return fail("shared thread", sharedResult.error);
  if (privateResult.error || !privateResult.data) return fail("private thread", privateResult.error);
  if (inviteResult.error || !inviteResult.data) return fail("invite link", inviteResult.error);

  return {
    teamName,
    inviteLink: `${await siteOrigin()}/invite/${inviteResult.data.token}`,
    sharedThreadId: sharedResult.data.id,
  };
}
