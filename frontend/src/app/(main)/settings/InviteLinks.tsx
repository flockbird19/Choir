"use client";

import { useState, useTransition } from "react";
import { Link as LinkIcon, Check, Ban } from "lucide-react";
import { generateInviteLink, revokeInviteLink } from "./actions";
import { Team, TeamInvitation } from "@/types/database";
import { Button, Dialog } from "@/components/ui";

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
    <div className="bg-surface border border-border rounded-2xl p-5 mt-8">
      <h2 className="text-sm font-semibold text-ink mb-1">Invite Members</h2>
      <p className="text-xs text-graphite mb-4">
        Generate a unique link to invite people to your team.
      </p>

      <div className="flex flex-col gap-3">
        {teams.length > 1 && (
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            aria-label="Select team to invite to"
            className="px-3 py-2 text-sm bg-canvas border border-border rounded-xl text-ink outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        {error && (
          <div role="alert" className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
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
              className="flex-1 px-3 py-2 text-sm bg-canvas border border-border rounded-xl text-ink font-mono"
            />
            <button
              onClick={handleCopy}
              className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors flex items-center gap-1.5"
            >
              {copied ? <Check size={14} /> : <LinkIcon size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setInviteLink(null)}
              className="px-3 py-2 text-sm text-graphite bg-surface-hover border border-border rounded-xl hover:text-ink transition-colors"
            >
              New
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={loading || !selectedTeam}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium bg-surface-hover text-ink border border-border rounded-xl hover:bg-canvas transition-colors self-start"
          >
            {loading ? "Generating..." : "Generate Invite Link"}
          </button>
        )}

        <div className="mt-2">
          <h3 className="text-xs font-semibold text-ink mb-2">Active links</h3>
          {teamInvites.length === 0 ? (
            <p className="text-xs text-graphite">No active invite links.</p>
          ) : (
            <ul className="divide-y divide-border border border-border rounded-xl">
              {teamInvites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      Link ending <span className="font-mono">{invite.token.slice(-6)}</span>
                    </p>
                    <p className="text-xs text-graphite">
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
