import { AppLayoutClient } from "../../components/AppLayoutClient";
import { getWorkspace } from "../../utils/supabase/queries";
import { getCurrentUser } from "../../utils/supabase/access";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { teams, projects, threads } = await getWorkspace(user.id);

  if (teams.length === 0) {
    redirect("/onboarding");
  }

  return (
    <AppLayoutClient
      user={user}
      teams={teams}
      projects={projects}
      threads={threads}
    >
      {children}
    </AppLayoutClient>
  );
}
