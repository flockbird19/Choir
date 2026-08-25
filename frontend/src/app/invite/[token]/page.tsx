import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { redirect } from "next/navigation";
import { AcceptInviteForm } from "./AcceptInviteForm";

export default async function InvitePage({
  params
}: {
  params: Promise<{ token: string }>
}) {
  const resolvedParams = await params;
  const { token } = resolvedParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/invite/${token}`);
  }

  const adminClient = createAdminClient();
  const { data: invite } = await adminClient
    .from("team_invitations")
    .select("team_id")
    .eq("token", token)
    .single();

  if (!invite) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-ink">
        <p>Invalid or expired invitation link.</p>
      </div>
    );
  }

  const { data: team } = await adminClient
    .from("teams")
    .select("name")
    .eq("id", invite.team_id)
    .single();

  if (!team) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-ink">
        <p>Team not found.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <div className="w-full max-w-md p-8 bg-surface border border-border rounded-2xl shadow-sm text-center">
        <h1 className="text-2xl font-semibold text-ink mb-2">You're Invited!</h1>
        <p className="text-graphite mb-6 text-sm">
          You've been invited to join the team <strong className="text-ink">{team.name}</strong> on Choir.
        </p>

        <AcceptInviteForm token={token} />
      </div>
    </div>
  );
}
