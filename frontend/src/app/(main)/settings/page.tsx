import { getSavedProviders } from "@/app/(main)/thread/[id]/actions";
import { SettingsClient } from "./SettingsClient";
import { InviteSection } from "./InviteSection";
import { DangerZone } from "./DangerZone";
import { KeyRound } from "lucide-react";
import { getWorkspace } from "@/utils/supabase/queries";
import { getCurrentUser } from "@/utils/supabase/access";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings — Choir",
  description: "Manage your API keys, integrations, and workspace settings.",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const [savedProviders, teams] = await Promise.all([
    getSavedProviders(),
    user ? getWorkspace(user.id).then((workspace) => workspace.teams) : Promise.resolve([]),
  ]);

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
            model. Your API keys are encrypted before being stored — only you can use them.
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

        {/* Section: Invite Members */}
        <InviteSection teams={teams} />

        {/* Danger Zone */}
        {user && <DangerZone teams={teams} currentUserId={user.id} />}
      </div>
    </main>
  );
}
