"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUser } from "@/utils/supabase/access";
import type { Team, TeamColour } from "@/types/database";

// Team page (2026-10-01). The database decides who may do what (schema.sql: any member edits
// the name, description and icon; owners remove people, make owners and delete; anyone leaves),
// so these actions pass the request on and turn its refusals into plain words.

type Result = { error?: string };

const MAX_NAME = 80;
const MAX_DESCRIPTION = 280;
const PENDING = "This needs a database update that hasn't been applied yet. Please try again later.";

function done(): Result {
  // The rail and channel list read teams in the root layout.
  revalidatePath("/", "layout");
  return {};
}

export async function updateTeamDetails(teamId: string, name: string, description: string): Promise<Result> {
  if (!(await getCurrentUser())) return { error: "Not logged in" };
  const trimmed = name.trim();
  const about = description.trim();
  if (!trimmed) return { error: "Give the team a name." };
  if (trimmed.length > MAX_NAME) return { error: `Keep the name under ${MAX_NAME} characters.` };
  if (about.length > MAX_DESCRIPTION) return { error: `Keep the description under ${MAX_DESCRIPTION} characters.` };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({ name: trimmed, description: about || null })
    .eq("id", teamId)
    .select("name");
  if (error?.code === "42703" || error?.code === "PGRST204") return { error: PENDING };
  // PostgREST drops a disallowed update silently, so check it actually took effect.
  if (error || data?.[0]?.name !== trimmed) return { error: "Couldn't save the team details. Please try again." };
  return done();
}

export interface TeamIconChoice {
  kind: NonNullable<Team["icon_kind"]>;
  name: string | null;
  color: TeamColour;
  /** A file just uploaded to team-icons/<team id>/…; null keeps the current image for kind "image". */
  path: string | null;
}

export async function saveTeamIcon(teamId: string, choice: TeamIconChoice): Promise<Result> {
  if (!(await getCurrentUser())) return { error: "Not logged in" };
  const supabase = await createClient();
  // The current image comes from the database, not the page: right after a save the page can
  // still show the one before, and its file would never be deleted.
  const { data: current, error: readError } = await supabase.from("teams").select("icon_path").eq("id", teamId).maybeSingle();
  if (readError?.code === "42703") return { error: PENDING };
  if (readError || !current) return { error: "Couldn't save the icon. Please try again." };
  const path = choice.kind === "image" ? choice.path ?? current.icon_path : null;
  if (choice.kind === "image" && !path) return { error: "Choose an image first." };

  const { data, error } = await supabase
    .from("teams")
    .update({
      icon_kind: choice.kind,
      icon_name: choice.kind === "icon" ? choice.name : null,
      icon_color: choice.color,
      icon_path: path,
    })
    .eq("id", teamId)
    .select("icon_kind");
  if (error?.code === "42703" || error?.code === "PGRST204") return { error: PENDING };
  if (error || data?.[0]?.icon_kind !== choice.kind) return { error: "Couldn't save the icon. Please try again." };
  // The old image is no longer used anywhere.
  if (current.icon_path && current.icon_path !== path) {
    await supabase.storage.from("team-icons").remove([current.icon_path]);
  }
  return done();
}

export async function leaveTeam(teamId: string): Promise<Result & { outcome?: string }> {
  if (!(await getCurrentUser())) return { error: "Not logged in" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leave_team", { p_team_id: teamId });
  if (error?.code === "PGRST202") return { error: PENDING };
  if (error) return { error: "Couldn't leave the team. Please try again." };
  done();
  return { outcome: data as string };
}

export async function removeMember(teamId: string, userId: string, revokeInvites: boolean): Promise<Result> {
  if (!(await getCurrentUser())) return { error: "Not logged in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_team_id: teamId,
    p_user_id: userId,
    p_revoke_invites: revokeInvites,
  });
  if (error?.code === "PGRST202") return { error: PENDING };
  if (error?.code === "42501") return { error: "Only owners can remove people." };
  if (error) return { error: "Couldn't remove them. Refresh the page and try again." };
  return done();
}

export async function makeOwner(teamId: string, userId: string): Promise<Result> {
  if (!(await getCurrentUser())) return { error: "Not logged in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("make_owner", { p_team_id: teamId, p_user_id: userId });
  if (error?.code === "PGRST202") return { error: PENDING };
  if (error?.code === "42501") return { error: "Only owners can make someone an owner." };
  if (error) return { error: "Couldn't make them an owner. Refresh the page and try again." };
  return done();
}
