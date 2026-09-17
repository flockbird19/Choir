/** Display names for the AI providers people can save keys for. */
export const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
};

export function providerName(provider: unknown): string {
  return (typeof provider === "string" && PROVIDER_NAMES[provider]) || "AI";
}
