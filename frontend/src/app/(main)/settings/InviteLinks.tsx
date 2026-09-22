"use client";

import { useState, useTransition } from "react";
import { Link as LinkIcon, Check, Ban, ChevronDown } from "lucide-react";
import { generateInviteLink, revokeInviteLink } from "./actions";
import { Team, TeamInvitation } from "@/types/database";
import { Button, Dialog, Menu, MenuRadioItem } from "@/components/ui";

export type ActiveInvite = Pick<TeamInvitation, "id" | "team_id" | "token" | "created_at" | "expires_at">;

function InviteDate({ iso }: { iso: string }) {
  // The server and the browser can be in different time zones, so the text may differ on hydration.
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
    </time>
  );
}

export function InviteLinks({ teams, invites }: { teams: Team[]; invites: ActiveInvite[] }) {
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string>(teams[0]?.id || "");
  const [error, setError] = useState<string | null>(null);
  const [confirmInvite, setConfirmInvite] = useState<ActiveInvite | null>(null);
  const [isRevoking, startRevoke] = useTransition();
  const teamInvites = invites.filter((invite) => invite.team_id === selectedTeam);

  const handleRevoke = () => {
    const invite = confirmInvite;
    if (!invite) return;
    setError(null);
    startRevoke(async () => {
      const result = await revokeInviteLink(invite.id);
      if (result.error) {
        setError(result.error);
      } else if (inviteLink?.endsWith(invite.token)) {
        setInviteLink(null);
      }
      setConfirmInvite(null);
    });
  };

  const handleGenerate = async () => {
    if (!selectedTeam) return;
    setLoading(true);
    setError(null);
    setInviteLink(null);
    setCopied(false);

    try {
      const result = await generateInviteLink(selectedTeam);
      if (result.error) {
        setError(result.error);
      } else if (result.link) {
        setInviteLink(result.link);
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (teams.length === 0) return null;

  return (
    <div className="bg-card border border-line rounded-card p-5 mt-8">
      <h2 className="text-sm font-semibold text-fg mb-1">Invite Members</h2>
      <p className="text-xs text-fg-muted mb-4">
        Generate a unique link to invite people to your team.
      </p>

      <div className="flex flex-col gap-3">
        {teams.length > 1 && (
          <Menu
            label="Select team to invite to"
            wrapperClassName="w-full"
            trigger={(props) => (
              <button
                {...props}
                type="button"
                className="focus-ring-in-container flex w-full items-center justify-between gap-2 px-3.5 h-11 sm:h-10 text-sm bg-card border border-field-line rounded-control text-fg outline-none focus:border-team focus:ring-2 focus:ring-team/25"
              >
                <span className="truncate">{teams.find((t) => t.id === selectedTeam)?.name ?? "Select a team"}</span>
                <ChevronDown size={16} className="text-fg-muted shrink-0" aria-hidden="true" />
              </button>
            )}
          >
            {teams.map((t) => (
              <MenuRadioItem key={t.id} checked={t.id === selectedTeam} onSelect={() => setSelectedTeam(t.id)}>
                {t.name}
              </MenuRadioItem>
            ))}
          </Menu>
        )}

        {error && (
          <div role="alert" className="text-xs text-danger bg-danger-soft border border-danger-line px-3 py-2 rounded-control">
            {error}
          </div>
        )}

        {inviteLink ? (
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={inviteLink}
              aria-label="Invite link"
              className="focus-ring-in-container flex-1 px-3 py-2 text-sm bg-card border border-field-line rounded-control text-fg font-mono outline-none focus:border-team focus:ring-2 focus:ring-team/25"
            />
            <Button variant="primary" onClick={handleCopy} leadingIcon={copied ? <Check size={14} /> : <LinkIcon size={14} />}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="secondary" onClick={() => setInviteLink(null)}>
              New
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={handleGenerate}
            disabled={loading || !selectedTeam}
            loading={loading}
            className="w-full sm:w-auto self-start"
          >
            Generate Invite Link
          </Button>
        )}

        <div className="mt-2">
          <h3 className="text-xs font-semibold text-fg mb-2">Active links</h3>
          {teamInvites.length === 0 ? (
            <p className="text-xs text-fg-muted">No active invite links.</p>
          ) : (
            <ul className="divide-y divide-line border border-line rounded-control">
              {teamInvites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-fg">
                      Link ending <span className="font-mono">{invite.token.slice(-6)}</span>
                    </p>
                    <p className="text-xs text-fg-muted">
                      Created <InviteDate iso={invite.created_at} />, expires <InviteDate iso={invite.expires_at} />
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<Ban size={14} aria-hidden="true" />}
                    onClick={() => setConfirmInvite(invite)}
                    aria-label={`Revoke link ending ${invite.token.slice(-6)}`}
                  >
                    Revoke link
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog
        open={!!confirmInvite}
        onClose={() => setConfirmInvite(null)}
        title="Revoke this invite link?"
        description="Anyone who opens it will see that it has expired. People who already joined stay in the workspace."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmInvite(null)} disabled={isRevoking}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRevoke} loading={isRevoking}>
              Revoke link
            </Button>
          </>
        }
      />
    </div>
  );
}
