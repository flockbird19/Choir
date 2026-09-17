import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { FormAlert, textLinkClass } from "@/components/auth/fields";
import { getCurrentUser } from "@/utils/supabase/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { AcceptInviteForm } from "./AcceptInviteForm";
import { isInviteUsable } from "./invite-status";

export const metadata: Metadata = {
  title: "Join a team — Choir",
  description: "You've been invited to a Choir workspace.",
};

function InviteProblem({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg">
        This invite doesn&rsquo;t work
      </h1>
      <FormAlert tone="error">{message}</FormAlert>
      <p className="text-[15px] text-fg-muted">Ask a teammate for a new link.</p>
      <Link href="/" className={`${textLinkClass} self-start`}>
        Go to your workspace
      </Link>
    </div>
  );
}

export default async function InvitePage({
  params
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params;

  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/invite/${token}`);
  }

  const adminClient = createAdminClient();
  const { data: invite } = await adminClient
    .from("team_invitations")
    .select("*") // "*" so this still works before schema.sql adds expires_at / revoked_at
    .eq("token", token)
    .maybeSingle();

  const { data: team } = invite && isInviteUsable(invite)
    ? await adminClient.from("teams").select("name").eq("id", invite.team_id).maybeSingle()
    : { data: null };

  return (
    <AuthShell>
      {!invite ? (
        <InviteProblem message="Invalid or expired invitation link." />
      ) : !isInviteUsable(invite) ? (
        <InviteProblem message="This invite link has expired." />
      ) : !team ? (
        <InviteProblem message="The team for this invite no longer exists." />
      ) : (
        <div className="animate-rise motion-reduce:animate-none">
          <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-primary">You&rsquo;re invited</p>
          <h1 className="mt-2 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg [overflow-wrap:anywhere]">
            Join {team.name}
          </h1>
          <p className="mt-2 mb-7 text-[15px] leading-relaxed text-fg-muted">
            You&rsquo;ll land in the team&rsquo;s shared space with a quick summary of what you missed, plus a private
            scratchpad of your own.
          </p>
          <AcceptInviteForm token={token} />
        </div>
      )}
    </AuthShell>
  );
}
