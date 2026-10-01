"use client";

import { useState } from "react";
import { PrimarySidebar } from "./PrimarySidebar";
import { SecondarySidebar } from "./SecondarySidebar";
import type { SessionUser } from "@/utils/supabase/access";
import { Team, Project, Thread } from "@/types/database";
import { usePathname, useRouter } from "next/navigation";

interface AppLayoutClientProps {
  user: SessionUser | null;
  teams: Team[];
  projects: Project[];
  threads: Thread[];
  children: React.ReactNode;
}

// DESIGN.md 5.4: fixed 64px rail + 264px channel column, not a resizable split —
// the channel column can fully collapse instead, so the chat can be the only
// thing on screen when you want it to be. Collapse state is session-only (not
// persisted to localStorage) to avoid a hydration mismatch on first paint.
export function AppLayoutClient({
  user,
  teams,
  projects,
  threads,
  children,
}: AppLayoutClientProps) {
  const pathname = usePathname();

  const threadIdMatch = pathname.match(/\/thread\/([a-zA-Z0-9-]+)/);
  const currentThreadId = threadIdMatch ? threadIdMatch[1] : null;

  const teamPageId = pathname.match(/^\/team\/([a-zA-Z0-9-]+)/)?.[1];
  let initialTeamId = teams[0]?.id || null;
  if (teamPageId && teams.some((t) => t.id === teamPageId)) {
    initialTeamId = teamPageId;
  } else if (currentThreadId) {
    const currentThread = threads.find((t) => t.id === currentThreadId);
    if (currentThread) {
      const currentProject = projects.find((p) => p.id === currentThread.project_id);
      if (currentProject) {
        initialTeamId = currentProject.team_id;
      }
    }
  }

  const [activeTeamId, setActiveTeamId] = useState<string | null>(initialTeamId);
  const router = useRouter();
  // Picking a team in the rail opens its Team Space straight away, instead of only
  // swapping the channel list while another team's thread stays on screen.
  const selectTeam = (teamId: string) => {
    setActiveTeamId(teamId);
    const projectIds = new Set(projects.filter((p) => p.team_id === teamId).map((p) => p.id));
    const teamSpace = threads.find((t) => t.type === "shared" && projectIds.has(t.project_id));
    if (teamSpace && teamSpace.id !== currentThreadId) router.push(`/thread/${teamSpace.id}`);
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  const activeTeam = teams.find((t) => t.id === activeTeamId) || null;
  // A team can have more than one project (the schema supports it even though
  // onboarding only ever creates one) — aggregate threads across all of the
  // active team's projects instead of silently dropping any beyond the first.
  const teamProjects = projects.filter((p) => p.team_id === activeTeamId);
  const activeProject = teamProjects[0] || null;

  const teamThreads = threads.filter((t) => teamProjects.some((p) => p.id === t.project_id));

  const sharedThread = teamThreads.find((t) => t.type === "shared") || null;
  const privateThreads = teamThreads.filter((t) => t.type === "private" && t.owner_id === user?.id);

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <PrimarySidebar
        teams={teams}
        activeTeamId={activeTeamId}
        onSelectTeam={selectTeam}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />

      <div
        className="h-full shrink-0 overflow-hidden border-r border-line transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: sidebarCollapsed ? 0 : 264 }}
      >
        <div className="h-full w-[264px]">
          <SecondarySidebar
            user={user}
            team={activeTeam}
            project={activeProject}
            sharedThread={sharedThread}
            privateThreads={privateThreads}
          />
        </div>
      </div>

      <main className="relative flex h-full min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
