import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/utils/supabase/access";
import { getWorkspace } from "@/utils/supabase/queries";
import { ConsentCard, type ProjectOption } from "./ConsentCard";

export const metadata: Metadata = { title: "Allow access — Choir" };

/**
 * Feature D: the page Supabase's OAuth server sends a person to when a coding agent (Claude Code,
 * Cursor…) asks to connect to Choir. Signed-out visitors sign in first and come back here.
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const back = `/oauth/consent${authorizationId ? `?authorization_id=${encodeURIComponent(authorizationId)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }
  const { teams, projects } = await getWorkspace(user.id);
  const options: ProjectOption[] = projects.map((p) => {
    const team = teams.find((t) => t.id === p.team_id);
    const several = projects.filter((q) => q.team_id === p.team_id).length > 1;
    return { id: p.id, label: several ? `${team?.name ?? "Team"} · ${p.name}` : (team?.name ?? p.name) };
  });
  return (
    <main className="grid min-h-dvh place-items-center bg-sunken px-4 py-10">
      <ConsentCard authorizationId={authorizationId ?? null} projects={options} />
    </main>
  );
}
