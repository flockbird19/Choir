"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteTeam } from "./actions";
import { Team } from "@/types/database";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

export function DangerZone({ teams, currentUserId }: { teams: Team[], currentUserId: string }) {
  const ownedTeams = teams.filter(t => t.created_by === currentUserId);
  const [isPending, startTransition] = useTransition();
  const { error: toastError, success: toastSuccess } = useToast();

  const [confirmTeamId, setConfirmTeamId] = useState<string | null>(null);
  const confirmTeam = ownedTeams.find((t) => t.id === confirmTeamId) ?? null;

  if (ownedTeams.length === 0) return null;

  const executeDelete = () => {
    if (!confirmTeamId) return;
    
    startTransition(async () => {
      const result = await deleteTeam(confirmTeamId);
      if (result.error) {
        toastError(result.error);
        setConfirmTeamId(null);
      } else {
        toastSuccess("Workspace deleted successfully.");
        window.location.href = "/"; // Refresh the app state by redirecting to home
      }
    });
  };

  return (
    <div className="mt-12 pt-8 border-t border-danger-line">
      <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-danger mb-3 px-1 flex items-center gap-2">
        <AlertTriangle size={14} />
        Danger Zone
      </h2>
      <div className="bg-danger-soft border border-danger-line rounded-card p-5 space-y-4">
        {ownedTeams.map(team => (
          <div key={team.id} className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-sm text-fg">{team.name}</p>
              <p className="text-xs text-fg-muted">Permanently delete this workspace and all data.</p>
            </div>
            <Button
              variant="ghost"
              onClick={() => setConfirmTeamId(team.id)}
              disabled={isPending}
              leadingIcon={<Trash2 size={16} />}
              className="text-danger hover:bg-danger-soft hover:text-danger"
            >
              {isPending && confirmTeamId === team.id ? "Deleting..." : "Delete Workspace"}
            </Button>
          </div>
        ))}
      </div>

      <Dialog
        open={!!confirmTeam}
        onClose={() => setConfirmTeamId(null)}
        title="Delete workspace?"
        description={
          confirmTeam
            ? `Are you absolutely sure? This will permanently delete "${confirmTeam.name}", all its projects, threads, and messages for everyone.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmTeamId(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={executeDelete} loading={isPending}>
              Yes, delete it
            </Button>
          </>
        }
      />
    </div>
  );
}
