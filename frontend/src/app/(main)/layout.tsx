import { AppLayoutClient } from "../../components/AppLayoutClient";
import { getWorkspace } from "../../utils/supabase/queries";
import { getCurrentUser } from "../../utils/supabase/access";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ShellSkeleton } from "../../components/ShellSkeleton";

// The skeleton lives here, not in app/loading.tsx, so login and the other public pages never show
// the app shell. A loading.tsx can't cover its own layout's data, hence the Suspense (Next.js docs).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Workspace>{children}</Workspace>
    </Suspense>
  );
}

async function Workspace({ children }: { children: React.ReactNode }) {
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
