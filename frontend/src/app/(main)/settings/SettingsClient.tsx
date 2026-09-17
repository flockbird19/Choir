"use client";

import { useState, useTransition, useEffect } from "react";
import { Check, Trash2, KeyRound, ExternalLink } from "lucide-react";
import { saveApiKey, deleteApiKey } from "@/app/(main)/thread/[id]/actions";
import { SharedKeysPanel } from "./SharedKeysPanel";

interface Provider {
  id: string;
  label: string;
  placeholder: string;
  docsUrl: string;
  hint: string;
}

const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-api03-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    hint: "Powers Claude Haiku 4.5 and other Claude models.",
  },
  {
    id: "openai",
    label: "OpenAI (GPT-4)",
    placeholder: "sk-proj-…",
    docsUrl: "https://platform.openai.com/api-keys",
    hint: "Powers gpt-4o and other OpenAI models.",
  },
  {
    id: "google",
    label: "Google (Gemini)",
    placeholder: "AIza…",
    docsUrl: "https://aistudio.google.com/app/apikey",
    hint: "Powers gemini-2.0-flash and other Gemini models.",
  },
  {
    id: "groq",
    label: "Groq",
    placeholder: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    hint: "Ultra-fast inference for open-source models like LLaMA 3.",
  },
];

interface KeyCardProps {
  provider: Provider;
  isSaved: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}

function KeyCard({ provider, isSaved, onSaved, onDeleted }: KeyCardProps) {
  const [inputValue, setInputValue] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (!inputValue.trim()) return;
    startTransition(async () => {
      const result = await saveApiKey(provider.id, inputValue.trim());
      if (result.error) {
        setFeedback({ type: "error", message: result.error });
      } else {
        setFeedback({ type: "success", message: "Key saved!" });
        setInputValue("");
        setShowInput(false);
        onSaved();
        setTimeout(() => setFeedback(null), 3000);
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteApiKey(provider.id);
      if (result.error) {
        setFeedback({ type: "error", message: result.error });
      } else {
        setFeedback({ type: "success", message: "Key removed." });
        onDeleted();
        setTimeout(() => setFeedback(null), 3000);
      }
    });
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-surface-hover flex items-center justify-center shrink-0">
            <KeyRound size={16} className="text-graphite" />
          </div>
          <div>
            <p className="font-semibold text-sm text-ink">{provider.label}</p>
            <p className="text-xs text-graphite mt-0.5">{provider.hint}</p>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 shrink-0">
          {isSaved ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 px-2.5 py-1 rounded-full">
              <Check size={11} />
              Saved
            </span>
          ) : (
            <span className="text-xs text-graphite/60 bg-surface-hover border border-border px-2.5 py-1 rounded-full">
              Not set
            </span>
          )}
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <p
          role={feedback.type === "error" ? "alert" : "status"}
          className={`text-xs px-3 py-2 rounded-lg border ${
            feedback.type === "success"
              ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50"
              : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50"
          }`}
        >
          {feedback.message}
        </p>
      )}

      {/* Input (shown when editing) */}
      {showInput && (
        <div className="flex gap-2">
          <input
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={provider.placeholder}
            aria-label={`${provider.label} API key`}
            autoFocus
            className="flex-1 px-3 py-2 text-sm bg-canvas border border-border rounded-xl outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 text-ink placeholder:text-graphite/40 font-mono"
          />
          <button
            onClick={handleSave}
            disabled={!inputValue.trim() || isPending}
            className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-xl hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => {
              setShowInput(false);
              setInputValue("");
            }}
            className="px-3 py-2 text-sm text-graphite bg-surface-hover border border-border rounded-xl hover:text-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Action buttons */}
      {!showInput && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInput(true)}
            className="px-3 py-1.5 text-xs font-medium bg-surface-hover border border-border text-graphite hover:text-ink hover:border-graphite/30 rounded-lg transition-colors"
          >
            {isSaved ? "Update key" : "Add key"}
          </button>

          {isSaved && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 border border-transparent hover:border-red-200 dark:hover:border-red-800/50 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 size={12} />
              Remove
            </button>
          )}

          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-graphite/50 hover:text-graphite transition-colors"
          >
            Get key
            <ExternalLink size={11} />
          </a>
        </div>
      )}
    </div>
  );
}

interface SettingsClientProps {
  initialSavedProviders: string[];
}

export function SettingsClient({ initialSavedProviders }: SettingsClientProps) {
  const [savedProviders, setSavedProviders] = useState<string[]>(initialSavedProviders);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedProviders(initialSavedProviders);
  }, [initialSavedProviders]);

  // Real optimistic updates — the server action also calls revalidatePath,
  // but that only takes effect on the next navigation. Updating state here
  // directly makes the "Saved" badge flip immediately.
  const handleProviderSaved = (providerId: string) => {
    setSavedProviders((prev) => (prev.includes(providerId) ? prev : [...prev, providerId]));
  };

  const handleProviderDeleted = (providerId: string) => {
    setSavedProviders((prev) => prev.filter((p) => p !== providerId));
  };

  return (
    <>
      <div className="space-y-3">
        {PROVIDERS.map((provider) => (
          <KeyCard
            key={provider.id}
            provider={provider}
            isSaved={savedProviders.includes(provider.id)}
            onSaved={() => handleProviderSaved(provider.id)}
            onDeleted={() => handleProviderDeleted(provider.id)}
          />
        ))}
      </div>
      <SharedKeysPanel savedProviders={savedProviders} />
    </>
  );
}
