import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/utils/supabase/access";
import { getWorkspace } from "@/utils/supabase/queries";
import { createClient } from "@/utils/supabase/server";
import { InviteSection } from "@/app/(main)/settings/InviteSection";
import { TeamPageClient, type TeamMemberRow } from "./TeamPageClient";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  const team = user ? (await getWorkspace(user.id)).teams.find((t) => t.id === id) : null;
  return { title: `${team?.name ?? "Team"} — Choir` };
}

// DESIGN.md 6, team page: who's in the team, invites, the team icon, Team Space AI, leave/delete.
export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspace(user.id);
  const team = workspace.teams.find((t) => t.id === id);
  if (!team) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-fg-muted">
        <p>Team not found, or you&apos;re not in it.</p>
      </div>
    );
  }
  const project = workspace.projects.find((p) => p.team_id === id) ?? null;

  // Access rules: members see their teammates' memberships and profiles, and who lends keys.
  const supabase = await createClient();
  const [{ data: memberships }, { data: lent }] = await Promise.all([
    supabase.from("team_members").select("user_id, role, joined_at").eq("team_id", id).order("joined_at"),
    project
      ? supabase.from("shared_keys").select("user_id, provider, mode").eq("project_id", project.id)
      : Promise.resolve({ data: [] as { user_id: string; provider: string; mode: string }[] }),
  ]);
  const ids = (memberships ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, display_name, kind, owner_id").in("id", ids)
    : { data: [] };
  const profileOf = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const members: TeamMemberRow[] = (memberships ?? []).map((m) => {
    const profile = profileOf.get(m.user_id);
    return {
      id: m.user_id,
      name: (profile?.display_name as string | null) || "Teammate",
      role: m.role === "owner" ? "owner" : "member",
      joinedAt: m.joined_at as string | null,
      isAgent: profile?.kind === "agent",
      agentOwnerId: (profile?.owner_id as string | null) ?? null,
    };
  });

  return (
    <TeamPageClient
      team={team}
      currentUserId={user.id}
      members={members}
      projectCreatorId={project?.created_by ?? null}
      sharedModel={project ? { provider: project.shared_model_provider ?? null, name: project.shared_model_name ?? null } : null}
      lenders={(lent ?? []).map((k) => ({ userId: k.user_id as string, provider: k.provider as string, mode: k.mode as string }))}
      invites={<InviteSection teamId={id} />}
    />
  );
}
