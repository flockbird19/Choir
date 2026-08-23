"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Lock, Users, Plus } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

import { User } from "@supabase/supabase-js";
import { Team, Project, Thread } from "@/types/database";

interface SidebarProps {
  user: User | null;
  team: Team | null;
  project: Project | null;
  sharedThread: Thread | null;
  privateThreads: Thread[];
}

export function Sidebar({ user, team, project, sharedThread, privateThreads }: SidebarProps) {
  const pathname = usePathname();

  const displayName =
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "User";

  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const isActive = (id: string) => pathname === `/thread/${id}`;

  return (
    <div className="w-72 h-full border-r border-border bg-surface flex flex-col shrink-0">

      {/* ── Header ─────────────────────────────── */}
      <div className="px-4 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="w-5 h-5 text-ink" />
          <span className="font-serif text-lg tracking-wide text-ink">Choir</span>
        </div>
        <ThemeToggle />
      </div>

      {/* ── Project / Team Label ─────────────── */}
      {(team || project) && (
        <div className="px-4 pt-3 pb-1">
          {team && (
            <p className="text-[10px] font-semibold text-graphite uppercase tracking-widest mb-0.5">
              {team.name}
            </p>
          )}
          {project && (
            <p className="text-sm font-medium text-ink truncate">{project.name}</p>
          )}
        </div>
      )}

      {/* ── Thread List ──────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-5">

        {/* Shared Thread — blue card treatment */}
        {sharedThread && (
          <div>
            <p className="px-2 mb-1.5 text-[10px] font-semibold text-graphite uppercase tracking-widest">
              Team
            </p>
            <Link
              href={`/thread/${sharedThread.id}`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all
                ${isActive(sharedThread.id)
                  ? "bg-shared shadow-sm shadow-shared/20 text-white"
                  : "bg-shared-muted hover:bg-shared/15 text-shared-fg"
                }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                ${isActive(sharedThread.id) ? "bg-white/20" : "bg-shared/15"}`}>
                <Users size={15} className={isActive(sharedThread.id) ? "text-white" : "text-shared"} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate
                  ${isActive(sharedThread.id) ? "text-white" : "text-shared-fg"}`}>
                  Team Space
                </p>
                <p className={`text-[11px] truncate
                  ${isActive(sharedThread.id) ? "text-white/65" : "text-shared/55"}`}>
                  Shared with all members
                </p>
              </div>
            </Link>
          </div>
        )}

        {/* Private Threads — compact list */}
        <div>
          <div className="px-2 mb-1.5 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-graphite uppercase tracking-widest">
              Your Threads
            </p>
            <button
              title="New private thread (coming soon)"
              className="w-5 h-5 rounded-md flex items-center justify-center text-graphite hover:text-ink hover:bg-surface-hover transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>

          {privateThreads.length === 0 ? (
            <div className="px-3 py-5 text-center rounded-lg border border-dashed border-border">
              <Lock size={14} className="text-graphite/40 mx-auto mb-2" />
              <p className="text-xs text-graphite">No private threads yet.</p>
              <p className="text-[11px] text-graphite/50 mt-0.5">
                Explore ideas privately with AI.
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {privateThreads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/thread/${thread.id}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors group
                    ${isActive(thread.id)
                      ? "bg-surface-hover text-ink"
                      : "text-graphite hover:bg-surface-hover hover:text-ink"
                    }`}
                >
                  <Lock
                    size={12}
                    className={`shrink-0 transition-opacity ${isActive(thread.id) ? "opacity-60" : "opacity-35 group-hover:opacity-60"}`}
                  />
                  <span className="text-sm truncate flex-1">
                    {thread.name || "Untitled Thread"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer / User ────────────────────── */}
      <div className="p-3 border-t border-border flex items-center gap-2.5">
        {/* Initials avatar */}
        <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold shrink-0 select-none">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink truncate">{displayName}</p>
          {user?.email && (
            <p className="text-[11px] text-graphite truncate">{user.email}</p>
          )}
        </div>
        <button
          title="Settings"
          className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-graphite hover:text-ink"
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
