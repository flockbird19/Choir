"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteTeam } from "./actions";
import { Team } from "@/types/database";
import { useToast } from "@/components/Toast";
import { useDialogA11y } from "@/hooks/useDialogA11y";

export function DangerZone({ teams, currentUserId }: { teams: Team[], currentUserId: string }) {
  const ownedTeams = teams.filter(t => t.created_by === currentUserId);
  const [isPending, startTransition] = useTransition();
  const { error: toastError, success: toastSuccess } = useToast();

  const [confirmTeamId, setConfirmTeamId] = useState<string | null>(null);
  const dialogRef = useDialogA11y(!!confirmTeamId, () => setConfirmTeamId(null));

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
    <div className="mt-12 pt-8 border-t border-red-500/20">
      <h2 className="text-xs font-bold uppercase tracking-widest text-red-500 mb-3 px-1 flex items-center gap-2">
        <AlertTriangle size={14} />
        Danger Zone
      </h2>
      <div className="bg-red-50/50 dark:bg-red-950/10 border border-red-500/20 rounded-2xl p-5 space-y-4">
        {ownedTeams.map(team => (
          <div key={team.id} className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-sm text-ink">{team.name}</p>
              <p className="text-xs text-graphite">Permanently delete this workspace and all data.</p>
            </div>
            <button
              onClick={() => setConfirmTeamId(team.id)}
              disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl transition-all hover:scale-[0.98] active:scale-95 disabled:opacity-50"
            >
              <Trash2 size={16} />
              {isPending && confirmTeamId === team.id ? "Deleting..." : "Delete Workspace"}
            </button>
          </div>
        ))}
      </div>

      {/* ── Custom Confirm Modal ── */}
      {confirmTeamId && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-ink/40 backdrop-blur-sm"
          onClick={() => !isPending && setConfirmTeamId(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-workspace-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-surface p-6 rounded-2xl shadow-xl w-full max-w-sm border border-red-500/20 mx-4"
          >
            <h3 id="delete-workspace-title" className="text-base font-semibold text-ink mb-2">Delete Workspace?</h3>
            <p className="text-sm text-graphite mb-6 leading-relaxed">
              Are you absolutely sure? This will <span className="font-bold text-red-500">permanently delete</span> the workspace, all its projects, threads, and messages for everyone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTeamId(null)}
                disabled={isPending}
                className="px-4 py-2 rounded-xl text-sm font-medium text-graphite hover:text-ink hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                disabled={isPending}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-all hover:scale-[0.98] active:scale-95 flex items-center gap-2"
              >
                {isPending ? "Deleting..." : "Yes, Delete It"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
