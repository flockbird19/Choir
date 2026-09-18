import { createAdminClient } from "./admin";

// E4: names come from the `profiles` table (backfilled for everyone, kept filled by a
// sign-up trigger, and updated the moment someone edits their own name) instead of one
// admin-API call per team member. Fixes the Cmd+K slowdown (FU-2) and the 5-minute
// rename delay (L14) that the old 5-minute cache caused.
export async function getTeamMemberNames(teamId: string): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data: members, error } = await admin.from("team_members").select("user_id").eq("team_id", teamId);
  if (error || !members || members.length === 0) {
    if (error) console.error("Error fetching team members:", error);
    return {};
  }

  const userIds = members.map((m) => m.user_id);
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  if (profilesError) console.error("Error fetching profiles:", profilesError);

  const names: Record<string, string> = {};
  for (const id of userIds) names[id] = "Teammate";
  for (const p of profiles ?? []) {
    if (p.display_name) names[p.id] = p.display_name;
  }
  return names;
}
