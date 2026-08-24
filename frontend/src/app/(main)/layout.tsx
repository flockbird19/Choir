import { AppLayoutClient } from "../../components/AppLayoutClient";
import { getUserTeams, getProjects, getThreads } from "../../utils/supabase/queries";
import { createClient } from "../../utils/supabase/server";
import { redirect } from "next/navigation";
import { Project, Thread, Team } from "../../types/database";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const teams = await getUserTeams() as Team[] || [];
  
  let allProjects: Project[] = [];
  let allThreads: Thread[] = [];

  if (teams.length > 0) {
    const projectPromises = teams.map(team => getProjects(team.id));
    const projectsArrays = await Promise.all(projectPromises);
    allProjects = projectsArrays.flat() as Project[];
    
    if (allProjects.length > 0) {
      const threadPromises = allProjects.map(project => getThreads(project.id));
      const threadsArrays = await Promise.all(threadPromises);
      allThreads = threadsArrays.flat() as Thread[];
    }
  }

  return (
    <AppLayoutClient 
      user={user} 
      teams={teams}
      projects={allProjects}
      threads={allThreads}
    >
      {children}
    </AppLayoutClient>
  );
}
