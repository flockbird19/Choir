import { getSavedProviders } from "@/app/(main)/thread/[id]/actions";
import { SettingsClient } from "./SettingsClient";
import { KeyRound } from "lucide-react";
import { ConnectAgentPanel, type Connection } from "./ConnectAgentPanel";
import { getCurrentUser } from "@/utils/supabase/access";
import { getWorkspace } from "@/utils/supabase/queries";
import { createClient } from "@/utils/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings · Choir",
  description: "Manage your API keys and integrations.",
};

// Invites and deleting a team moved to each team's own page (/team/<id>, 2026-10-01).
export default async function SettingsPage() {
  const savedProviders = await getSavedProviders();
  const connections = await getConnections();

  return (
    <main className="h-full overflow-y-auto bg-bg">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-card bg-team-soft flex items-center justify-center">
              <KeyRound size={18} className="text-team" />
            </div>
            <h1 className="font-display text-3xl text-fg">Settings</h1>
          </div>
          <p className="text-fg-muted text-sm leading-relaxed">
            Choir uses a{" "}
            <span className="font-medium text-fg">Bring Your Own Key (BYOK)</span>{" "}
            model. Your API keys are encrypted before they are stored, and only you can use them.
            The AI you get in each thread depends on which keys you have saved here.
          </p>
        </div>

        {/* Section: API Keys */}
        <div>
          <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-fg-subtle mb-3 px-1">
            API Keys
          </h2>
          <SettingsClient initialSavedProviders={savedProviders} />
        </div>

        {/* Section: Connect your AI (feature D stage 2) */}
        <div className="mt-10">
          <ConnectAgentPanel connections={connections} />
        </div>
      </div>
    </main>
  );
}

/** Your connected coding tools (active grants), labelled with their project. */
async function getConnections(): Promise<Connection[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const [{ data }, { teams, projects }] = await Promise.all([
    supabase
      .from("agent_grants")
      .select("id, client_name, project_id, last_used_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    getWorkspace(user.id),
  ]);
  return (data ?? []).map((g) => {
    const project = projects.find((p) => p.id === g.project_id);
    const team = teams.find((t) => t.id === project?.team_id);
    return {
      id: g.id,
      tool: g.client_name,
      project: !team
        ? "A project you left"
        : projects.filter((p) => p.team_id === team.id).length > 1
          ? `${team.name} · ${project?.name}`
          : team.name,
      lastUsed: g.last_used_at,
    };
  });
}
