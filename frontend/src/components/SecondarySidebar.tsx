"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Lock, Users, Plus, Hash } from "lucide-react";
import { User } from "@supabase/supabase-js";
import { Team, Project, Thread } from "@/types/database";

interface SecondarySidebarProps {
  user: User | null;
  team: Team | null;
  project: Project | null;
  sharedThread: Thread | null;
  privateThreads: Thread[];
}

export function SecondarySidebar({ user, team, project, sharedThread, privateThreads }: SecondarySidebarProps) {
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
    <div className="w-full h-full bg-surface flex flex-col shrink-0">
      
      {/* ── Server Header ───────────────────────── */}
      <div className="px-4 py-4 border-b border-border shadow-sm shadow-black/5 z-10 flex items-center justify-between cursor-pointer hover:bg-surface-hover transition-colors">
        <h2 className="font-semibold text-[15px] text-ink truncate">
          {team?.name || "Select a Team"}
        </h2>
      </div>

      {/* ── Thread List ──────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-6">

        {/* Shared Thread (Team Space) */}
        {sharedThread && (
          <div>
            <Link
              href={`/thread/${sharedThread.id}`}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-all group
                ${isActive(sharedThread.id)
                  ? "bg-surface-hover text-ink"
                  : "text-graphite hover:bg-surface-hover hover:text-ink"
                }`}
            >
              <Hash size={16} className={`shrink-0 ${isActive(sharedThread.id) ? "text-ink" : "text-graphite group-hover:text-ink"}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-[15px] font-medium truncate leading-tight`}>
                  team-space
                </p>
              </div>
            </Link>
          </div>
        )}

        {/* Private Threads (Direct Messages equivalent) */}
        <div>
          <div className="px-2 mb-1 flex items-center justify-between group cursor-pointer hover:text-ink text-graphite">
            <p className="text-[11px] font-bold uppercase tracking-wider transition-colors">
              Private Chats
            </p>
            <button
              title="New private thread"
              className="w-4 h-4 rounded-sm flex items-center justify-center transition-colors hover:bg-border"
            >
              <Plus size={14} />
            </button>
          </div>

          {privateThreads.length === 0 ? (
            <div className="px-3 py-5 text-center mt-2">
              <Lock size={14} className="text-graphite/40 mx-auto mb-2" />
              <p className="text-xs text-graphite">No private threads yet.</p>
            </div>
          ) : (
            <div className="space-y-0.5 mt-1">
              {privateThreads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/thread/${thread.id}`}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors group
                    ${isActive(thread.id)
                      ? "bg-surface-hover text-ink"
                      : "text-graphite hover:bg-surface-hover hover:text-ink"
                    }`}
                >
                  {/* User-like avatar for private threads to mimic DMs */}
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    <Lock size={12} className="text-accent" />
                  </div>
                  <span className="text-[15px] font-medium truncate flex-1">
                    {thread.name || "Untitled"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── User Profile (Discord-style bottom) ── */}
      <div className="p-2 border-t border-border bg-surface flex items-center gap-2 shrink-0">
        <div className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors cursor-pointer min-w-0">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold shrink-0 select-none">
              {initials}
            </div>
            {/* Online indicator */}
            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-surface rounded-full"></div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <p className="text-[13px] font-semibold text-ink leading-tight truncate">{displayName}</p>
            <p className="text-[11px] text-graphite leading-tight truncate">Online</p>
          </div>
        </div>
        <Link
          href="/settings"
          title="User Settings"
          className={`w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover transition-colors shrink-0
            ${pathname === "/settings" ? "text-ink bg-surface-hover" : "text-graphite hover:text-ink"}`}
        >
          <Settings size={18} />
        </Link>
      </div>
    </div>
  );
}
