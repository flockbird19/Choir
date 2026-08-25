"use server";

import { createClient } from "@/utils/supabase/server";

export async function generateInviteLink(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Insert into team_invitations
  const { data, error } = await supabase
    .from("team_invitations")
    .insert({ team_id: teamId, created_by: user.id })
    .select("token")
    .single();

  if (error || !data) {
    return { error: "Failed to generate invite link. Are you an owner?" };
  }

  // Generate link
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return { link: `${baseUrl}/invite/${data.token}` };
}

export async function deleteTeam(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

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
