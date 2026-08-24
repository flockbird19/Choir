import { getSavedProviders } from "@/app/(main)/thread/[id]/actions";
import { SettingsClient } from "./SettingsClient";
import { KeyRound } from "lucide-react";

export default async function SettingsPage() {
  const savedProviders = await getSavedProviders();

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <KeyRound size={18} className="text-accent" />
            </div>
            <h1 className="font-serif text-3xl text-ink">Settings</h1>
          </div>
          <p className="text-graphite text-sm leading-relaxed">
            Choir uses a{" "}
            <span className="font-medium text-ink">Bring Your Own Key (BYOK)</span>{" "}
            model. Your API keys are encrypted before being stored — only you can use them.
            The AI you get in each thread depends on which keys you have saved here.
          </p>
        </div>

        {/* Section: API Keys */}
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-graphite mb-3 px-1">
            API Keys
          </h2>
          <SettingsClient initialSavedProviders={savedProviders} />
        </div>

      </div>
    </div>
  );
}
