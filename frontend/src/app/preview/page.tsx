import { redirect } from "next/navigation";
import { getCurrentUser } from "@/utils/supabase/access";
import { getWorkspace } from "@/utils/supabase/queries";

// /preview opens the redesigned view on your first team's shared thread.
export default async function PreviewIndex() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/preview");
  const { teams, projects, threads } = await getWorkspace(user.id);
  if (teams.length === 0) redirect("/onboarding");
  const projectIds = projects.filter((p) => p.team_id === teams[0].id).map((p) => p.id);
  const shared = threads.find((t) => t.type === "shared" && projectIds.includes(t.project_id)) ?? threads[0];
  redirect(shared ? `/preview/thread/${shared.id}` : "/home");
}
