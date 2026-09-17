"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUser, isTeamMember } from "@/utils/supabase/access";
import { siteOrigin } from "@/utils/site-origin";

export async function generateInviteLink(teamId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  if (!(await isTeamMember(user.id, teamId))) {
    return { error: "You can only create invite links for a workspace you belong to." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .insert({ team_id: teamId, created_by: user.id })
    .select("token")
    .single();

  if (error || !data) {
    return { error: "Failed to generate invite link. Are you an owner?" };
  }

  revalidatePath("/settings");

  // Generate link
  const baseUrl = await siteOrigin();
  return { link: `${baseUrl}/invite/${data.token}` };
}

export async function revokeInviteLink(inviteId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // The database only lets workspace members do this, and only lets them set revoked_at.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("revoked_at", null)
    .select("id");

  if (error || !data?.length) {
    return { error: "Couldn't revoke this link. Refresh the page and try again." };
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function deleteTeam(teamId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();
  // Double check the user is the owner
  const { data: team } = await supabase.from("teams").select("created_by").eq("id", teamId).single();
  
  if (!team || team.created_by !== user.id) {
    return { error: "Only the team owner can delete this workspace." };
  }

  const { error } = await supabase.from("teams").delete().eq("id", teamId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
