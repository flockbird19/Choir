"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export async function acceptInvite(token: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not logged in" };
  }

  const adminClient = createAdminClient();

  // 1. Validate token
  const { data: invite, error: inviteError } = await adminClient
    .from("team_invitations")
    .select("team_id")
    .eq("token", token)
    .single();

  if (inviteError || !invite) {
    return { error: "Invalid or expired invitation link." };
  }

  const teamId = invite.team_id;

  // 2. Check if already a member
  const { data: existingMember } = await adminClient
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .single();

  if (existingMember) {
    // Already a member, just redirect
    return { success: true };
  }

  // 3. Add to team
  const { error: memberError } = await adminClient
    .from("team_members")
    .insert({ team_id: teamId, user_id: user.id, role: "member" });

  if (memberError) {
    return { error: "Failed to join team: " + memberError.message };
  }

  // 4. Create a default private thread in the team's first project
  const { data: projects } = await adminClient
    .from("projects")
    .select("id")
    .eq("team_id", teamId)
    .order("created_at")
    .limit(1);

  if (projects && projects.length > 0) {
    await adminClient.from("threads").insert({
      project_id: projects[0].id,
      type: "private",
      owner_id: user.id,
      name: "My Scratchpad",
    });
  }

  return { success: true };
}
