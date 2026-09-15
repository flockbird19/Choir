// Only same-site paths: "//evil.com" or "/\evil.com" would let a Choir link send people off-site.
export function safeRedirectPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
