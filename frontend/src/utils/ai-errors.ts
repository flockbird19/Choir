// Backend wording when the caller has no usable key: "No API key found…" / "Could not retrieve API key…".
export function isMissingKeyError(message: unknown): boolean {
  return typeof message === "string" && /no api key found|could not retrieve api key/i.test(message);
}

export const MISSING_KEY_AUTO_REPLY_MESSAGE =
  "AI replies need your own API key. Add one in Settings, or mute AI replies for this thread.";
