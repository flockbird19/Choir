"use client";

import { useState, useTransition, useEffect } from "react";
import { Check, Trash2, KeyRound, ExternalLink } from "lucide-react";
import { saveApiKey, deleteApiKey } from "@/app/(main)/thread/[id]/actions";
import { SharedKeysPanel } from "./SharedKeysPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export interface Provider {
  id: string;
  label: string;
  placeholder: string;
  docsUrl: string;
  hint: string;
}

export const PROVIDERS: Provider[] = [
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

export interface KeyCardProps {
  provider: Provider;
  isSaved: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}

export function KeyCard({ provider, isSaved, onSaved, onDeleted }: KeyCardProps) {
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
    <div className="bg-card border border-line rounded-card p-5 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-control bg-hover flex items-center justify-center shrink-0">
            <KeyRound size={16} className="text-fg-muted" />
          </div>
          <div>
            <p className="font-semibold text-sm text-fg">{provider.label}</p>
            <p className="text-xs text-fg-muted mt-0.5">{provider.hint}</p>
          </div>
        </div>

        {/* Status badge */}
        <div className="shrink-0">
          {isSaved ? (
            <Badge tone="success" icon={<Check size={11} />}>Saved</Badge>
          ) : (
            <Badge tone="neutral">Not set</Badge>
          )}
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <p
          role={feedback.type === "error" ? "alert" : "status"}
          className={`text-xs px-3 py-2 rounded-control border ${
            feedback.type === "success"
              ? "text-success bg-success-soft border-success/25"
              : "text-danger bg-danger-soft border-danger-line"
          }`}
        >
          {feedback.message}
        </p>
      )}

      {/* Input (shown when editing) */}
      {showInput && (
        <div className="flex gap-2 items-end">
          <Input
            label={`${provider.label} key`}
            hideLabel
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={provider.placeholder}
            autoFocus
            className="font-mono"
          />
          <Button variant="primary" size="md" onClick={handleSave} disabled={!inputValue.trim() || isPending} loading={isPending}>
            Save
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setShowInput(false);
              setInputValue("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Action buttons */}
      {!showInput && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowInput(true)}>
            {isSaved ? "Update key" : "Add key"}
          </Button>

          {isSaved && (
            <Button
              variant="dangerGhost"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
              leadingIcon={<Trash2 size={12} />}
            >
              Remove
            </Button>
          )}

          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted transition-colors"
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
