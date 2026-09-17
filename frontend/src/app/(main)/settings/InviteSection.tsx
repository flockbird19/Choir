import { createClient } from "@/utils/supabase/server";
import type { Team } from "@/types/database";
import { InviteLinks, type ActiveInvite } from "./InviteLinks";

export async function InviteSection({ teams }: { teams: Team[] }) {
  if (teams.length === 0) return null;

  // Access rules limit this to the user's own workspaces. Until schema.sql adds
  // expires_at / revoked_at this query fails and the list is simply empty.
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_invitations")
    .select("id, team_id, token, created_at, expires_at")
    .in("team_id", teams.map((team) => team.id))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  return <InviteLinks teams={teams} invites={(data ?? []) as ActiveInvite[]} />;
}
