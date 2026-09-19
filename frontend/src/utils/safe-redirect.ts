// Only same-site paths: "//evil.com" or "/\evil.com" would let a Choir link send people off-site.
// Signed-in home (the public landing page lives at "/").
//
// Tabs, newlines and carriage returns are stripped BEFORE the checks below. URL parsing
// removes those characters, so "/\t/evil.com" passes a naive startsWith("//") test and
// then resolves to "https://evil.com" once new URL() or a Location header sees it —
// an open redirect straight off the back of the sign-in and email-confirm flows.
const URL_STRIPPED_CHARS = /[\t\n\r]/g;

export function safeRedirectPath(value: string | null | undefined, fallback = "/home"): string {
  const path = value?.replace(URL_STRIPPED_CHARS, "");
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return fallback;
  }
  return path;
}
