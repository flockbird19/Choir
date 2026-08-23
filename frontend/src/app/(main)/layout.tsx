import { Sidebar } from "../../components/Sidebar";
import { getUserTeams, getProjects, getThreads } from "../../utils/supabase/queries";
import { createClient } from "../../utils/supabase/server";
import { redirect } from "next/navigation";
import { Project, Thread } from "../../types/database";

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

  const teams = await getUserTeams() || [];
  const activeTeam = teams[0] || null;

  let projects: Project[] = [];
  let threads: Thread[] = [];

  if (activeTeam) {
    projects = await getProjects(activeTeam.id) as Project[] || [];
    const activeProject = projects[0];
    if (activeProject) {
      threads = await getThreads(activeProject.id) as Thread[] || [];
    }
  }

  const sharedThread = threads.find((t: Thread) => t.type === 'shared') || null;
  const privateThreads = threads.filter((t: Thread) => t.type === 'private' && t.owner_id === user.id);

  return (
    <div className="flex h-full w-full bg-canvas overflow-hidden">
      <Sidebar 
        user={user} 
        team={activeTeam} 
        project={projects[0] || null} 
        sharedThread={sharedThread} 
        privateThreads={privateThreads} 
      />
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        {children}
      </main>
    </div>
  );
}
