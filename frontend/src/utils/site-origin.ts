import { headers } from "next/headers";

// The address people should use to reach this app, for links we hand out (e.g. invites).
// NEXT_PUBLIC_SITE_URL wins in production; in development the request's own origin keeps
// links pointing at whichever port the dev server runs on.
export async function siteOrigin(): Promise<string> {
  const requestHeaders = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL || requestHeaders.get("origin") || "http://localhost:3000";
}
