"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Lock, Plus, Hash, Trash2 } from "lucide-react";
import type { SessionUser } from "@/utils/supabase/access";
import { getDisplayName } from "@/utils/display-name";
import { Team, Project, Thread } from "@/types/database";
import { useEffect, useState } from "react";
import { createThread, deleteThread } from "@/app/(main)/thread/[id]/actions";
import { useToast } from "@/components/Toast";
import { useDialogA11y } from "@/hooks/useDialogA11y";

type StatusId = "online" | "away" | "dnd" | "offline";

const STATUS_COLORS: Record<StatusId, string> = {
  online: "bg-green-500",
  away: "bg-amber-400",
  dnd: "bg-red-500",
  offline: "bg-graphite/40",
};

interface SecondarySidebarProps {
  user: SessionUser | null;
  team: Team | null;
  project: Project | null;
  sharedThread: Thread | null;
  privateThreads: Thread[];
}

export function SecondarySidebar({ user, team, project, sharedThread, privateThreads }: SecondarySidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const [status, setStatus] = useState<StatusId>("online");
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !newThreadName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    const result = await createThread(project.id, newThreadName.trim());
    setIsSubmitting(false);
    if (result.success && result.threadId) {
      setIsCreatingThread(false);
      setNewThreadName("");
      router.push(`/thread/${result.threadId}`);
      router.refresh();
    } else {
      toastError(result.error || "Failed to create thread.");
    }
  };

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string, threadName: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Use a client-side confirm via state instead of window.confirm
    setConfirmDeleteId(threadId);
    setConfirmDeleteName(threadName);
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>("");

  const createThreadDialogRef = useDialogA11y(isCreatingThread, () => {
    setIsCreatingThread(false);
    setNewThreadName("");
  });
  const deleteDialogRef = useDialogA11y(!!confirmDeleteId, () => setConfirmDeleteId(null));

  const executeDelete = async () => {
    if (!confirmDeleteId) return;
    const threadId = confirmDeleteId;
    setConfirmDeleteId(null);
    const result = await deleteThread(threadId);
    if (result.success) {
      toastSuccess("Thread deleted.");
      if (pathname === `/thread/${threadId}`) {
        router.push("/");
        router.refresh();
      } else {
        router.refresh();
      }
    } else {
      toastError(result.error || "Failed to delete thread.");
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("choir_status") as StatusId | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setStatus(saved);
    const onFocus = () => {
      const s = localStorage.getItem("choir_status") as StatusId | null;
      if (s) setStatus(s);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const displayName = getDisplayName(user);

  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const isActive = (id: string) => pathname === `/thread/${id}`;

  return (
    <div className="w-full h-full bg-surface flex flex-col shrink-0">

      {/* ── Server Header ───────────────────────────── */}
      <div className="px-4 py-4 border-b border-border shadow-sm shadow-black/5 z-10 flex items-center justify-between">
        <h2 className="font-semibold text-[15px] text-ink truncate">
          {team?.name || "Select a Team"}
        </h2>
      </div>

      {/* ── Thread List ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-4">

        {/* ── Team Space section ── */}
        {sharedThread && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-graphite/50 px-2 mb-1">
              Team
            </p>
            <Link
              href={`/thread/${sharedThread.id}`}
              className={`flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all group
                ${isActive(sharedThread.id)
                  ? "bg-shared/10 text-shared-fg"
                  : "text-graphite hover:bg-shared/6 hover:text-shared-fg"
                }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors
                ${isActive(sharedThread.id) ? "bg-shared/15 text-shared" : "bg-surface-hover text-graphite group-hover:bg-shared/12 group-hover:text-shared"}`}>
                <Hash size={14} />
              </div>
              <span className="text-[14px] font-medium truncate flex-1">
                {sharedThread.name || "Team Space"}
              </span>
            </Link>
          </div>
        )}

        {/* Divider */}
        {sharedThread && <div className="h-px bg-border mx-1" />}

        {/* ── Private threads section ── */}
        <div className="flex-1">
          <div className="px-2 mb-1 flex items-center justify-between text-graphite">
            <p className="text-[10px] font-bold uppercase tracking-widest text-graphite/50">
              Private
            </p>
            <button
              onClick={() => setIsCreatingThread(true)}
              title="New private thread"
              aria-label="New private thread"
              className="min-w-[24px] min-h-[24px] rounded-md flex items-center justify-center transition-colors hover:bg-border hover:text-ink"
            >
              <Plus size={13} />
            </button>
          </div>

          {privateThreads.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <Lock size={13} className="text-graphite/30 mx-auto mb-1.5" />
              <p className="text-xs text-graphite/50">No threads yet.</p>
              <button
                onClick={() => setIsCreatingThread(true)}
                className="mt-2 text-[11px] text-accent hover:underline"
              >
                Create one
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {privateThreads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/thread/${thread.id}`}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors group
                    ${isActive(thread.id)
                      ? "bg-surface-hover text-ink"
                      : "text-graphite hover:bg-surface-hover hover:text-ink"
                    }`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors
                    ${isActive(thread.id) ? "bg-accent/15 text-accent" : "bg-surface-hover text-graphite/60 group-hover:bg-accent/10 group-hover:text-accent"}`}>
                    <Lock size={11} />
                  </div>
                  <span className="text-[14px] font-medium truncate flex-1">
                    {thread.name || "Untitled"}
                  </span>
                  <button
                    onClick={(e) => handleDeleteThread(e, thread.id, thread.name || "Untitled")}
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 min-w-[24px] min-h-[24px] flex items-center justify-center text-graphite hover:text-red-500 transition-all rounded-md hover:bg-red-500/10 shrink-0"
                    title="Delete thread"
                    aria-label={`Delete thread "${thread.name || "Untitled"}"`}
                  >
                    <Trash2 size={12} />
                  </button>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── User Profile (bottom) ── */}
      <div className="p-2 border-t border-border bg-surface flex items-center gap-2 shrink-0">
        <Link
          href="/profile"
          className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors min-w-0 ${
            pathname === "/profile" ? "bg-surface-hover" : ""
          }`}
        >
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold select-none">
              {initials}
            </div>
            <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-2 border-surface rounded-full ${STATUS_COLORS[status]}`} />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <p className="text-[13px] font-semibold text-ink leading-tight truncate">{displayName}</p>
            <p className="text-[11px] text-graphite leading-tight truncate capitalize">
              {status === "dnd" ? "Do Not Disturb" : status}
            </p>
          </div>
        </Link>
        <Link
          href="/settings"
          title="Settings"
          aria-label="Settings"
          className={`w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover transition-colors shrink-0
            ${pathname === "/settings" ? "text-ink bg-surface-hover" : "text-graphite hover:text-ink"}`}
        >
          <Settings size={18} />
        </Link>
      </div>

      {/* ── Create Thread Modal ── */}
      {isCreatingThread && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm"
          onClick={() => { setIsCreatingThread(false); setNewThreadName(""); }}
        >
          <div
            ref={createThreadDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-thread-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-surface p-6 rounded-2xl shadow-xl w-full max-w-sm border border-border mx-4"
          >
            <h3 id="new-thread-title" className="text-base font-semibold text-ink mb-4">New Thread</h3>
            <form onSubmit={handleCreateThread}>
              <input
                type="text"
                autoFocus
                value={newThreadName}
                onChange={(e) => setNewThreadName(e.target.value)}
                placeholder="e.g. Exploring auth flow…"
                className="w-full px-3 py-2 bg-canvas border border-border rounded-xl text-ink mb-4 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-colors text-sm"
                disabled={isSubmitting}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setIsCreatingThread(false); setNewThreadName(""); }}
                  className="px-4 py-2 rounded-xl text-sm text-graphite hover:text-ink hover:bg-surface-hover transition-colors"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent/90 transition-all hover:scale-[0.98] active:scale-95 disabled:opacity-50"
                  disabled={!newThreadName.trim() || isSubmitting}
                >
                  {isSubmitting ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-thread-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-surface p-6 rounded-2xl shadow-xl w-full max-w-sm border border-border mx-4"
          >
            <h3 id="delete-thread-title" className="text-base font-semibold text-ink mb-1">Delete Thread?</h3>
            <p className="text-sm text-graphite mb-5">
              &ldquo;{confirmDeleteName}&rdquo; will be permanently deleted with all its messages.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 rounded-xl text-sm text-graphite hover:text-ink hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                className="px-4 py-2 rounded-xl text-sm bg-red-500 text-white hover:bg-red-600 transition-all hover:scale-[0.98] active:scale-95"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
