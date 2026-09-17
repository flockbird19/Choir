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
}

export function PrimarySidebar({ teams, activeTeamId, onSelectTeam }: PrimarySidebarProps) {
  return (
    <nav
      aria-label="Teams"
      className="w-16 h-full flex flex-col items-center py-4 bg-surface-hover/50 border-r border-border shrink-0 z-30"
    >

      {/* Home / Logo */}
      <Link href="/" aria-label="Home" className="group relative flex items-center justify-center w-12 h-12 mb-2">
        <div className="absolute -left-4 w-2 h-5 bg-ink rounded-r-full opacity-0 group-hover:opacity-100 transition-all duration-300" />
        <div className="w-12 h-12 rounded-[24px] group-hover:rounded-[16px] bg-canvas flex items-center justify-center shadow-sm transition-all duration-300 group-active:translate-y-[1px]">
          <Logo className="w-6 h-6 text-ink group-hover:text-accent transition-colors duration-300" />
        </div>
      </Link>

      <div className="w-8 h-[2px] bg-border rounded-full mb-2" />

      {/* Teams List */}
      <div className="flex-1 w-full overflow-y-auto no-scrollbar flex flex-col items-center gap-2">
        {teams.map((team) => {
          const isActive = team.id === activeTeamId;
          const initials = team.name.substring(0, 2).toUpperCase();

          return (
            <button
              key={team.id}
              onClick={() => onSelectTeam(team.id)}
              className="group relative flex items-center justify-center w-full h-12"
              title={team.name}
              aria-label={team.name}
              aria-pressed={isActive}
            >
              {/* Active / Hover indicator pill */}
              <div
                className={`absolute left-0 w-1 bg-ink rounded-r-full transition-all duration-300 ${
                  isActive
                    ? "h-10 opacity-100"
                    : "h-5 opacity-0 group-hover:opacity-100"
                }`}
              />

              {/* Team Icon */}
              <div
                className={`w-12 h-12 flex items-center justify-center font-semibold text-sm transition-all duration-300 shadow-sm
                  ${
                    isActive
                      ? "rounded-[16px] bg-accent text-white"
                      : "rounded-[24px] hover:rounded-[16px] bg-canvas text-graphite hover:bg-accent-light hover:text-white"
                  }
                `}
              >
                {initials}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-auto pt-4 flex flex-col gap-3 items-center">
        <NotificationBell look="classic" threadHref={(id) => `/thread/${id}`} />
        <ThemeToggle />
      </div>
    </nav>
  );
}
