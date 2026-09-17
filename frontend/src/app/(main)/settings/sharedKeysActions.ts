"use server";

import { getCurrentUser } from "@/utils/supabase/access";
import { getWorkspace } from "@/utils/supabase/queries";
import { getTeamMemberNames } from "@/utils/supabase/member-names";

export interface LendingProject {
  id: string;
  name: string;
  teamName: string;
}

/**
 * What the Shared keys panel needs: the signed-in user's projects and the names of
 * everyone on their teams. Lending itself goes straight through Supabase (RLS).
 */
export async function getSharedKeysSetup(): Promise<{
  userId: string;
  projects: LendingProject[];
  names: Record<string, string>;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { teams, projects } = await getWorkspace(user.id);
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const nameLists = await Promise.all(teams.map((team) => getTeamMemberNames(team.id)));

  return {
    userId: user.id,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      teamName: teamNames.get(project.team_id) ?? "",
    })),
    names: Object.assign({}, ...nameLists),
  };
}
