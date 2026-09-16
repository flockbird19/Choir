// Only same-site paths: "//evil.com" or "/\evil.com" would let a Choir link send people off-site.
// Signed-in home (the public landing page lives at "/").
export function safeRedirectPath(value: string | null | undefined, fallback = "/home"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
