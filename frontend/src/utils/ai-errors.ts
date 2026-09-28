// Backend wording when the caller has no usable key: "No API key found…" / "Could not retrieve API key…".
export function isMissingKeyError(message: unknown): boolean {
  return typeof message === "string" && /no api key found|could not retrieve api key/i.test(message);
}

export const MISSING_KEY_AUTO_REPLY_MESSAGE =
  "AI replies need your own API key. Add one in Settings, or switch this thread to AI waits.";

// When you explicitly asked (AI waits + Ask AI or @AI), "switch to AI waits" makes no sense.
export const MISSING_KEY_ASK_MESSAGE = "Asking AI needs your own API key. Add one in Settings → API keys.";
