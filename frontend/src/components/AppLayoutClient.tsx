"use client";

import { useState } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { PrimarySidebar } from "./PrimarySidebar";
import { SecondarySidebar } from "./SecondarySidebar";
import { User } from "@supabase/supabase-js";
import { Team, Project, Thread } from "@/types/database";
import { usePathname } from "next/navigation";

interface AppLayoutClientProps {
  user: User | null;
  teams: Team[];
  projects: Project[];
  threads: Thread[];
  children: React.ReactNode;
}

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

  let initialTeamId = teams[0]?.id || null;
  if (currentThreadId) {
    const currentThread = threads.find(t => t.id === currentThreadId);
    if (currentThread) {
      const currentProject = projects.find(p => p.id === currentThread.project_id);
      if (currentProject) {
        initialTeamId = currentProject.team_id;
      }
    }
  }

  const [activeTeamId, setActiveTeamId] = useState<string | null>(initialTeamId);

  const activeTeam = teams.find(t => t.id === activeTeamId) || null;
  // A team can have more than one project (the schema supports it even though
  // onboarding only ever creates one) — aggregate threads across all of the
  // active team's projects instead of silently dropping any beyond the first.
  const teamProjects = projects.filter(p => p.team_id === activeTeamId);
  const activeProject = teamProjects[0] || null;

  const teamThreads = threads.filter(t => teamProjects.some(p => p.id === t.project_id));

  const sharedThread = teamThreads.find(t => t.type === 'shared') || null;
  const privateThreads = teamThreads.filter(t => t.type === 'private' && t.owner_id === user?.id);

  return (
    <div className="flex h-full w-full bg-canvas overflow-hidden">
      <PrimarySidebar
        teams={teams}
        activeTeamId={activeTeamId}
        onSelectTeam={setActiveTeamId}
      />

      <PanelGroup orientation="horizontal" className="flex-1">
        <Panel
          defaultSize="20"
          minSize="15"
          maxSize="35"
          className="h-full border-r border-border relative z-10"
        >
          <SecondarySidebar
            user={user}
            team={activeTeam}
            project={activeProject}
            sharedThread={sharedThread}
            privateThreads={privateThreads}
          />
        </Panel>

        <PanelResizeHandle className="w-[1px] bg-border hover:w-1 hover:bg-accent-light transition-all cursor-col-resize active:bg-accent active:w-1 z-20 -ml-[1px]" />

        <Panel defaultSize="80" minSize="40" className="h-full min-w-0">
          <main className="w-full h-full flex flex-col min-w-0 relative">
            {children}
          </main>
        </Panel>
      </PanelGroup>
    </div>
  );
}
