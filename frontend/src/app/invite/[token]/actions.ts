"use server";

import { getCurrentUser } from "@/utils/supabase/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { EXPIRED_INVITE_MESSAGE, isInviteUsable } from "./invite-status";

export type AcceptInviteResult = { error: string } | { sharedThreadId: string | null };

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not logged in" };
  }

  const adminClient = createAdminClient();

  // 1. Validate token
  const { data: invite, error: inviteError } = await adminClient
    .from("team_invitations")
    .select("*") // "*" so this still works before schema.sql adds expires_at / revoked_at
    .eq("token", token)
    .single();

  if (inviteError || !invite) {
    return { error: "Invalid or expired invitation link." };
  }

  // Expired or revoked links never add anyone, even someone already in the team.
  if (!isInviteUsable(invite)) {
    return { error: EXPIRED_INVITE_MESSAGE };
  }

  const teamId = invite.team_id;

  // The team's first project holds the Team Space the invitee lands in.
  const { data: projects } = await adminClient
    .from("projects")
    .select("id")
    .eq("team_id", teamId)
    .order("created_at")
    .limit(1);
  const projectId: string | null = projects?.[0]?.id ?? null;

  const findSharedThreadId = async (): Promise<string | null> => {
    if (!projectId) return null;
    const { data } = await adminClient
      .from("threads")
      .select("id")
      .eq("project_id", projectId)
      .eq("type", "shared")
      .order("created_at")
      .limit(1);
    return data?.[0]?.id ?? null;
  };

  // 2. Check if already a member
  const { data: existingMember } = await adminClient
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember) {
    return { sharedThreadId: await findSharedThreadId() };
  }

  // 3. Add to team
  const { error: memberError } = await adminClient
    .from("team_members")
    .insert({ team_id: teamId, user_id: user.id, role: "member" });

  if (memberError) {
    return { error: "Failed to join team: " + memberError.message };
  }

  // 4. Create a default private thread in the team's first project
  const [sharedThreadId] = await Promise.all([
    findSharedThreadId(),
    projectId
      ? adminClient.from("threads").insert({
          project_id: projectId,
          type: "private",
          owner_id: user.id,
          name: "My Scratchpad",
        })
      : Promise.resolve(null),
  ]);

  return { sharedThreadId };
}
