import { createClient } from "@/utils/supabase/server";
import { siteOrigin } from "@/utils/site-origin";
import { InviteLinks, type ActiveInvite } from "./InviteLinks";

// The team page's "Invite people" section (moved from Settings 2026-10-01). Access rules
// limit this to the user's own teams.
export async function InviteSection({ teamId }: { teamId: string }) {
  const supabase = await createClient();
  const [{ data }, origin] = await Promise.all([
    supabase
      .from("team_invitations")
      .select("id, team_id, token, created_at, expires_at, created_by")
      .eq("team_id", teamId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    siteOrigin(),
  ]);

  return <InviteLinks teamId={teamId} origin={origin} invites={(data ?? []) as ActiveInvite[]} />;
}
