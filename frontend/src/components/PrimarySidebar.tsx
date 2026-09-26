"use client";

import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { Team } from "@/types/database";

interface PrimarySidebarProps {
  teams: Team[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

// DESIGN.md 5.4: the rail is 64px, sunken, one squircle per workspace.
// 5.2: icons are a 12px radius by default, 10px with a ring when active.
export function PrimarySidebar({
  teams,
  activeTeamId,
  onSelectTeam,
  sidebarCollapsed,
  onToggleSidebar,
}: PrimarySidebarProps) {
  return (
    <nav
      aria-label="Workspaces"
      className="flex h-full w-16 shrink-0 flex-col items-center gap-3 border-r border-line bg-sunken py-4"
    >
      <Link
        href="/"
        aria-label="Choir home"
        className="grid size-10 place-items-center rounded-[14px] text-fg transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-team"
      >
        <Logo className="size-6" />
      </Link>

      <div className="h-px w-6 bg-line" />

      <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
        {teams.map((team) => {
          const isActive = team.id === activeTeamId;
          const initials = team.name.substring(0, 2).toUpperCase();

          return (
            <button
              key={team.id}
              onClick={() => onSelectTeam(team.id)}
              title={team.name}
              aria-label={team.name}
              aria-pressed={isActive}
              className={`grid size-11 shrink-0 place-items-center font-mono text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? "rounded-[10px] bg-team text-white shadow-[0_0_0_2px_var(--color-team-line)]"
                  : "rounded-[12px] bg-card text-fg-muted hover:text-fg"
              }`}
            >
              {initials}
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-pressed={sidebarCollapsed}
          title={sidebarCollapsed ? "Show the channel list" : "Hide the channel list"}
          aria-label={sidebarCollapsed ? "Show the channel list" : "Hide the channel list"}
          className="grid size-10 place-items-center rounded-[10px] text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <PanelIcon collapsed={sidebarCollapsed} />
        </button>
        <NotificationBell />
        <ThemeToggle />
      </div>
    </nav>
  );
}

function PanelIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="15" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2.5V15.5" stroke="currentColor" strokeWidth="1.5" />
      {!collapsed && <rect x="2.5" y="3.5" width="3.5" height="11" rx="1" fill="currentColor" opacity="0.35" />}
    </svg>
  );
}
