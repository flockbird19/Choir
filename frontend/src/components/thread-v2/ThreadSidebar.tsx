"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, LayoutList, Lock, Plus, Search, Settings, UserRound, Users } from "lucide-react";
import type { Project, Team, Thread } from "@/types/database";
import { createThread } from "@/app/(main)/thread/[id]/actions";
import { NotificationBell } from "@/components/NotificationBell";
import { useToast } from "@/components/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Menu, MenuItem, MenuLabel, MenuRadioItem, MenuSeparator } from "@/components/ui/Menu";
import { ThemeSwitch } from "@/components/ui/ThemeSwitch";
import { cn } from "@/components/ui/cn";

export interface SidebarProps {
  user: { id: string; name: string; email?: string };
  teams: Team[];
  projects: Project[];
  threads: Thread[];
  activeThread: Thread;
  onNavigate?: () => void;
}

function openSearch() {
  // The command palette (root layout) listens for Cmd/Ctrl+K.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
}

const rowClass =
  "group flex h-11 w-full items-center gap-2.5 rounded-control px-2.5 text-body-sm outline-none sm:h-8 " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

export function ThreadSidebar({ user, teams, projects, threads, activeThread, onNavigate }: SidebarProps) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const activeProject = projects.find((p) => p.id === activeThread.project_id) ?? null;
  const activeTeam = teams.find((t) => t.id === activeProject?.team_id) ?? teams[0] ?? null;
  const teamProjects = projects.filter((p) => p.team_id === activeTeam?.id);
  const teamThreads = threads.filter((t) => teamProjects.some((p) => p.id === t.project_id));
  const shared = teamThreads.filter((t) => t.type === "shared");
  const privateThreads = teamThreads
    .filter((t) => t.type === "private" && t.owner_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const firstSharedOf = (teamId: string) => {
    const ids = projects.filter((p) => p.team_id === teamId).map((p) => p.id);
    return threads.find((t) => t.type === "shared" && ids.includes(t.project_id));
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeProject || !newName.trim() || saving) return;
    setSaving(true);
    const result = await createThread(activeProject.id, newName.trim());
    setSaving(false);
    if (result.success && result.threadId) {
      setCreating(false);
      setNewName("");
      onNavigate?.();
      router.push(`/preview/thread/${result.threadId}`);
      router.refresh();
    } else {
      toastError(result.error || "Couldn't create the thread.");
    }
  };

  const threadLink = (thread: Thread) => {
    const active = thread.id === activeThread.id;
    const isShared = thread.type === "shared";
    return (
      <li key={thread.id}>
        <Link
          href={`/preview/thread/${thread.id}`}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            rowClass,
            active ? "bg-selected font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"
          )}
        >
          {isShared ? (
            <Users size={15} aria-hidden="true" className="shrink-0 text-team" />
          ) : (
            <Lock size={14} aria-hidden="true" className={cn("shrink-0", active ? "text-private" : "text-fg-subtle")} />
          )}
          <span className="truncate">{thread.name || (isShared ? "Team Space" : "Untitled thread")}</span>
        </Link>
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sunken">
      {/* Team switcher */}
      <div className="flex h-header shrink-0 items-center gap-1 border-b border-line px-2">
        <Menu
          label="Switch team"
          wrapperClassName="min-w-0 flex-1"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-control px-2 sm:h-10 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-hover"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-primary text-caption font-bold text-on-primary">
                {(activeTeam?.name ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-body-sm font-semibold text-fg">{activeTeam?.name ?? "No team"}</span>
                {activeProject && <span className="truncate text-caption text-fg-subtle">{activeProject.name}</span>}
              </span>
              <ChevronsUpDown size={14} aria-hidden="true" className="shrink-0 text-fg-subtle" />
            </button>
          )}
          className="w-64"
        >
          <MenuLabel>Your teams</MenuLabel>
          {teams.map((team) => {
            const target = firstSharedOf(team.id);
            return (
              <MenuRadioItem
                key={team.id}
                checked={team.id === activeTeam?.id}
                onSelect={() => {
                  if (!target || team.id === activeTeam?.id) return;
                  onNavigate?.();
                  router.push(`/preview/thread/${target.id}`);
                }}
              >
                {team.name}
              </MenuRadioItem>
            );
          })}
          <MenuSeparator />
          <MenuItem icon={<Settings />} onSelect={() => router.push("/settings")}>
            Team settings and invites
          </MenuItem>
        </Menu>
      </div>

      <div className="flex flex-col gap-1 p-2">
        <button type="button" onClick={openSearch} className={cn(rowClass, "cursor-pointer text-fg-muted hover:bg-hover hover:text-fg")}>
          <Search size={15} aria-hidden="true" className="shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
        </button>
      </div>

      <nav aria-label="Threads" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-2.5 pb-1 pt-3 text-caption font-semibold uppercase tracking-wider text-fg-muted">Shared with the team</p>
        <ul className="flex flex-col gap-0.5">{shared.map(threadLink)}</ul>

        <div className="flex items-center justify-between pb-1 pl-2.5 pr-1 pt-5">
          <p className="text-caption font-semibold uppercase tracking-wider text-fg-muted">Your private threads</p>
          <IconButton label="New private thread" icon={<Plus />} size="sm" tooltipSide="right" onClick={() => setCreating(true)} disabled={!activeProject} />
        </div>
        {privateThreads.length > 0 ? (
          <ul className="flex flex-col gap-0.5">{privateThreads.map(threadLink)}</ul>
        ) : (
          <p className="px-2.5 py-2 text-label text-fg-muted">No private threads yet. Start one to explore an idea on your own.</p>
        )}
      </nav>

      {/* You */}
      <div className="relative z-30 flex shrink-0 items-center gap-1 border-t border-line p-2">
        <Menu
          label="Account"
          wrapperClassName="min-w-0 flex-1"
          side="top"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-control px-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-hover"
            >
              <Avatar name={user.name} colorKey={user.id} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-body-sm font-medium text-fg">{user.name}</span>
                {user.email && <span className="truncate text-caption text-fg-subtle">{user.email}</span>}
              </span>
            </button>
          )}
          className="w-60"
        >
          <MenuItem icon={<UserRound />} onSelect={() => router.push("/profile")}>Profile</MenuItem>
          <MenuItem icon={<Settings />} onSelect={() => router.push("/settings")}>Settings and API keys</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<LayoutList />} onSelect={() => router.push(`/thread/${activeThread.id}`)}>
            Back to the classic view
          </MenuItem>
        </Menu>
        <NotificationBell look="v2" threadHref={(id) => `/preview/thread/${id}`} />
        <ThemeSwitch size="sm" />
      </div>

      <Dialog
        open={creating}
        onClose={() => {
          setCreating(false);
          setNewName("");
        }}
        title="New private thread"
        description="Only you can see it. The AI here already knows your team's shared thread."
        width="26rem"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="new-thread-form" loading={saving} disabled={!newName.trim()}>
              Create thread
            </Button>
          </>
        }
      >
        <form id="new-thread-form" onSubmit={create}>
          <Input label="Thread name" placeholder="e.g. Pitch ideas" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={80} />
        </form>
      </Dialog>
    </div>
  );
}
