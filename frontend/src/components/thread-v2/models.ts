// Same list and storage key as components/chat/ChatInput.tsx, so the picked model is shared
// between the classic thread view and this preview. Keep in sync until the classic view is removed.
export interface ModelOption {
  provider: "anthropic" | "openai" | "google" | "groq";
  id: string;
  name: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
  { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
  { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { provider: "openai", id: "o3", name: "o3" },
  { provider: "openai", id: "o4-mini", name: "o4-mini" },
  { provider: "google", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { provider: "groq", id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
];

export const PROVIDER_LABELS: Record<ModelOption["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
};

export const MODEL_STORAGE_KEY = "choir_selected_model";

export const modelKey = (model: ModelOption) => `${model.provider}:${model.id}`;

export function findModel(key: string | null | undefined): ModelOption | undefined {
  return AVAILABLE_MODELS.find((model) => modelKey(model) === key);
}

/** @AI anywhere in the text, as its own word (same rule as the classic composer). */
export const AI_TRIGGER = /\B@AI\b/i;

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
