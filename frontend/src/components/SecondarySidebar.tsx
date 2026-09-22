"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Lock, Plus, MessagesSquare, Trash2 } from "lucide-react";
import type { SessionUser } from "@/utils/supabase/access";
import { getDisplayName, getInitials } from "@/utils/display-name";
import { Team, Project, Thread } from "@/types/database";
import { useState } from "react";
import { createThread, deleteThread } from "@/app/(main)/thread/[id]/actions";
import { useToast } from "@/components/Toast";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { StatusId } from "@/app/(main)/profile/actions";
import { useTeammateStatuses, STATUS_DOT_CLASS, STATUS_LABEL } from "@/hooks/useTeammateStatuses";

interface SecondarySidebarProps {
  user: SessionUser | null;
  team: Team | null;
  project: Project | null;
  sharedThread: Thread | null;
  privateThreads: Thread[];
}

// DESIGN.md 5.4/7: the channel column is 264px, `bg`, right `line` border. Team Space
// gets a navy dot, private threads a green dot; the active row is `selected` fill.
export function SecondarySidebar({ user, team, project, sharedThread, privateThreads }: SecondarySidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const statuses = useTeammateStatuses();
  const status: StatusId = (user && statuses[user.id]) || "online";
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>("");

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

  const handleDeleteThread = (e: React.MouseEvent, threadId: string, threadName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDeleteId(threadId);
    setConfirmDeleteName(threadName);
  };

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

  const displayName = getDisplayName(user);
  const initials = getInitials(displayName);
  const isActive = (id: string) => pathname === `/thread/${id}`;

  return (
    <div className="flex h-full w-full shrink-0 flex-col bg-bg">
      <div className="flex h-14 items-center border-b border-line px-4">
        <h2 className="truncate font-sans text-[15px] font-semibold text-fg">
          {team?.name || "Select a team"}
        </h2>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {sharedThread && (
          <>
            <p className="px-2 pb-1 pt-2 font-mono text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              Shared
            </p>
            <Link
              href={`/thread/${sharedThread.id}`}
              className={`flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] transition-colors ${
                isActive(sharedThread.id)
                  ? "bg-selected font-semibold text-team hover:bg-team-soft"
                  : "text-fg-muted hover:bg-hover hover:text-fg"
              }`}
            >
              <MessagesSquare size={15} className="shrink-0 text-team" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{sharedThread.name || "Team Space"}</span>
            </Link>
          </>
        )}

        <div className="mt-3 flex items-center justify-between px-2 pb-1">
          <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            Private threads
          </p>
          <button
            onClick={() => setIsCreatingThread(true)}
            title="New private thread"
            aria-label="New private thread"
            className="grid size-6 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            <Plus size={13} />
          </button>
        </div>

        {privateThreads.length === 0 ? (
          <div className="px-2 py-4 text-center">
            <Lock size={13} className="mx-auto mb-1.5 text-fg-subtle" aria-hidden="true" />
            <p className="text-xs text-fg-subtle">No threads yet.</p>
            <button
              onClick={() => setIsCreatingThread(true)}
              className="mt-1.5 text-[12px] font-medium text-team hover:underline"
            >
              Create one
            </button>
          </div>
        ) : (
          privateThreads.map((thread) => (
            <Link
              key={thread.id}
              href={`/thread/${thread.id}`}
              className={`group flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] transition-colors ${
                isActive(thread.id)
                  ? "bg-selected font-semibold text-fg hover:bg-hover"
                  : "text-fg-muted hover:bg-hover hover:text-fg"
              }`}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-private" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{thread.name || "Untitled"}</span>
              <button
                onClick={(e) => handleDeleteThread(e, thread.id, thread.name || "Untitled")}
                className="grid size-6 shrink-0 place-items-center rounded-md text-fg-subtle opacity-0 transition-all hover:bg-danger-soft hover:text-danger focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                title="Delete thread"
                aria-label={`Delete thread "${thread.name || "Untitled"}"`}
              >
                <Trash2 size={12} />
              </button>
            </Link>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line p-2">
        <Link
          href="/profile"
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-hover ${
            pathname === "/profile" ? "bg-hover" : ""
          }`}
        >
          <div className="relative shrink-0">
            <div className="grid size-8 select-none place-items-center rounded-full bg-team text-[12px] font-semibold text-white">
              {initials}
            </div>
            <div
              role="img"
              aria-label={`Status: ${STATUS_LABEL[status]}`}
              className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-bg ${STATUS_DOT_CLASS[status]}`}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <p className="truncate text-[13px] font-semibold leading-tight text-fg">{displayName}</p>
            <p className="truncate text-[11px] capitalize leading-tight text-fg-subtle">{STATUS_LABEL[status]}</p>
          </div>
        </Link>
        <Link
          href="/settings"
          title="Settings"
          aria-label="Settings"
          className={`grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors hover:bg-hover ${
            pathname === "/settings" ? "bg-hover text-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          <Settings size={17} />
        </Link>
      </div>

      {isCreatingThread && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-sm"
          onClick={() => { setIsCreatingThread(false); setNewThreadName(""); }}
        >
          <div
            ref={createThreadDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-thread-title"
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-sm rounded-panel border border-line bg-card p-6 shadow-[var(--ds-shadow-overlay)]"
          >
            <h3 id="new-thread-title" className="mb-4 font-display text-[19px] font-medium text-fg">
              New thread
            </h3>
            <form onSubmit={handleCreateThread}>
              <input
                id="new-thread-name"
                type="text"
                autoFocus
                value={newThreadName}
                onChange={(e) => setNewThreadName(e.target.value)}
                placeholder="e.g. Exploring auth flow…"
                className="mb-4 w-full rounded-[10px] border border-field-line bg-field px-3 py-2 text-sm text-fg transition-colors focus:outline-none focus:ring-2 focus:ring-team/30"
                disabled={isSubmitting}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setIsCreatingThread(false); setNewThreadName(""); }}
                  className="rounded-[10px] px-4 py-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-[10px] bg-fg px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                  disabled={!newThreadName.trim() || isSubmitting}
                >
                  {isSubmitting ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-sm"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-thread-title"
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-sm rounded-panel border border-line bg-card p-6 shadow-[var(--ds-shadow-overlay)]"
          >
            <h3 id="delete-thread-title" className="mb-1 font-display text-[19px] font-medium text-fg">
              Delete thread?
            </h3>
            <p className="mb-5 text-sm text-fg-muted">
              &ldquo;{confirmDeleteName}&rdquo; will be permanently deleted with all its messages.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-[10px] px-4 py-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                className="rounded-[10px] bg-danger px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
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
