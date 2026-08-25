"use client";

import { useState } from "react";
import { Link as LinkIcon, Check } from "lucide-react";
import { generateInviteLink } from "./actions";
import { Team } from "@/types/database";

export function InviteSection({ teams }: { teams: Team[] }) {
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string>(teams[0]?.id || "");
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
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
          <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        {inviteLink ? (
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={inviteLink}
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
      </div>
    </div>
  );
}
