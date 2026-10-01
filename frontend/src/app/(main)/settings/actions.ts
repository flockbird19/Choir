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
    return { error: "Couldn't create an invite link. Please try again." };
  }

  revalidatePath("/team/[id]", "page");

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

  revalidatePath("/team/[id]", "page");
  return { success: true };
}

export async function deleteTeam(teamId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // The database lets owners delete their team (schema.sql "Owners can delete their team");
  // a refused delete removes nothing rather than erroring, so check a row actually went.
  const supabase = await createClient();
  const { data, error } = await supabase.from("teams").delete().eq("id", teamId).select("id");

  if (error) {
    return { error: "Couldn't delete the team. Please try again." };
  }
  if (!data?.length) {
    return { error: "Only owners can delete this team." };
  }

  revalidatePath("/", "layout");
  return { success: true };
}
