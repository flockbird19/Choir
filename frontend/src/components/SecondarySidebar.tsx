"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Lock, Plus, MessagesSquare, Trash2, Info, Bot } from "lucide-react";
import type { SessionUser } from "@/utils/supabase/access";
import { getDisplayName, getInitials } from "@/utils/display-name";
import { Team, Project, Thread } from "@/types/database";
import { useState } from "react";
import { createThread, deleteThread } from "@/app/(main)/thread/[id]/actions";
import { useToast } from "@/components/Toast";
import { Button, Dialog, Input } from "@/components/ui";
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
      <div className="flex h-14 items-center border-b border-line px-2">
        {team ? (
          // DESIGN.md 6, team page: the team name opens it (rename lives there now).
          <Link
            href={`/team/${team.id}`}
            aria-current={pathname === `/team/${team.id}` ? "page" : undefined}
            data-tooltip="Team info, members and invites"
            className={`flex h-10 w-full min-w-0 items-center gap-2 rounded-[10px] px-2.5 transition-colors hover:bg-hover ${
              pathname === `/team/${team.id}` ? "bg-selected" : ""
            }`}
          >
            <h2 className="min-w-0 flex-1 truncate font-sans text-[15px] font-semibold text-fg">{team.name}</h2>
            <Info size={15} className="shrink-0 text-fg-muted" aria-hidden="true" />
          </Link>
        ) : (
          <h2 className="px-2.5 font-sans text-[15px] font-semibold text-fg">Select a team</h2>
        )}
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
            data-tooltip="New private thread"
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
              {/* ponytail: task threads are recognised by the name start_task gives them; add a column if names ever collide. */}
              {thread.name?.startsWith("Task · ") ? (
                <Bot size={13} className="shrink-0 text-private" aria-hidden="true" />
              ) : (
                <span className="size-1.5 shrink-0 rounded-full bg-private" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{thread.name || "Untitled"}</span>
              <button
                onClick={(e) => handleDeleteThread(e, thread.id, thread.name || "Untitled")}
                className="grid size-6 shrink-0 place-items-center rounded-md text-fg-subtle opacity-0 transition-all hover:bg-danger-soft hover:text-danger focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                data-tooltip="Delete thread"
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
          data-tooltip="Settings"
          aria-label="Settings"
          className={`grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors hover:bg-hover ${
            pathname === "/settings" ? "bg-hover text-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          <Settings size={17} />
        </Link>
      </div>

      <Dialog
        open={isCreatingThread}
        onClose={() => { setIsCreatingThread(false); setNewThreadName(""); }}
        title="New thread"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => { setIsCreatingThread(false); setNewThreadName(""); }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-thread-form"
              variant="primary"
              disabled={!newThreadName.trim() || isSubmitting}
              loading={isSubmitting}
            >
              Create
            </Button>
          </>
        }
      >
        <form id="new-thread-form" onSubmit={handleCreateThread}>
          <Input
            label="Thread name"
            hideLabel
            autoFocus
            value={newThreadName}
            onChange={(e) => setNewThreadName(e.target.value)}
            placeholder="e.g. Exploring auth flow…"
            disabled={isSubmitting}
          />
        </form>
      </Dialog>

      <Dialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete thread?"
        description={`"${confirmDeleteName}" will be permanently deleted with all its messages.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={executeDelete}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
