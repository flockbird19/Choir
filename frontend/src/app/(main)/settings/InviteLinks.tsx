"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link as LinkIcon, Check, Ban, Copy } from "lucide-react";
import { generateInviteLink, revokeInviteLink } from "./actions";
import type { TeamInvitation } from "@/types/database";
import { Button, Dialog } from "@/components/ui";

export type ActiveInvite = Pick<TeamInvitation, "id" | "team_id" | "token" | "created_at" | "expires_at"> & {
  created_by?: string | null;
};

function daysLeft(iso: string) {
  const days = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  return days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
}

// DESIGN.md 6, team page: "Create invite link" and a row per active link (link, expiry, Copy, Revoke).
export function InviteLinks({ teamId, origin, invites }: { teamId: string; origin: string; invites: ActiveInvite[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmInvite, setConfirmInvite] = useState<ActiveInvite | null>(null);
  const [isRevoking, startRevoke] = useTransition();
  const linkFor = (invite: ActiveInvite) => `${origin}/invite/${invite.token}`;

  const copy = async (invite: ActiveInvite) => {
    try {
      await navigator.clipboard.writeText(linkFor(invite));
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((id) => (id === invite.id ? null : id)), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  const create = async () => {
    setCreating(true);
    setError(null);
    const result = await generateInviteLink(teamId);
    setCreating(false);
    if (result.error) setError(result.error);
    else router.refresh();
  };

  const revoke = () => {
    const invite = confirmInvite;
    if (!invite) return;
    setError(null);
    startRevoke(async () => {
      const result = await revokeInviteLink(invite.id);
      if (result.error) setError(result.error);
      setConfirmInvite(null);
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="invite-heading" className="font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
          Invite people
        </h2>
        <Button size="sm" onClick={create} loading={creating} leadingIcon={<LinkIcon size={14} aria-hidden="true" />}>
          Create invite link
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-body-sm text-danger">
          {error}
        </p>
      )}

      {invites.length === 0 ? (
        <p className="text-body-sm text-fg-muted">No active invite links. Links last 7 days.</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-card">
          {invites.map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] text-fg" data-tooltip={linkFor(invite)}>
                  {linkFor(invite).replace(/^https?:\/\//, "")}
                </p>
                <p className="text-caption text-fg-subtle" suppressHydrationWarning>
                  {daysLeft(invite.expires_at)}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copy(invite)}
                  leadingIcon={copiedId === invite.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                >
                  {copiedId === invite.id ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="dangerGhost"
                  size="sm"
                  leadingIcon={<Ban size={14} aria-hidden="true" />}
                  onClick={() => setConfirmInvite(invite)}
                  aria-label={`Revoke link ending ${invite.token.slice(-6)}`}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!confirmInvite}
        onClose={() => setConfirmInvite(null)}
        title="Revoke this invite link?"
        description="Anyone who opens it will see that it has expired. People who already joined stay in the team."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmInvite(null)} disabled={isRevoking}>
              Cancel
            </Button>
            <Button variant="danger" onClick={revoke} loading={isRevoking}>
              Revoke link
            </Button>
          </>
        }
      />
    </section>
  );
}
