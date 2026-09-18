import type { createClient } from "./client";

type BrowserClient = ReturnType<typeof createClient>;

/**
 * Hands the current login token to Realtime, and keeps handing it over every time
 * supabase-js refreshes it.
 *
 * Realtime only ever uses the token it was given before `subscribe()`. The browser
 * client refreshes the login token on its own about once an hour, but nothing told
 * Realtime — so the socket carried on presenting an expired token, the server closed
 * it, and every channel died with "socket closed: 1006" after roughly an hour open.
 *
 * Returns the session (callers need it for their own guards) and a `stop` function
 * to call when the subscription is torn down.
 */
export async function keepRealtimeAuthFresh(
  supabase: BrowserClient
): Promise<{ session: Awaited<ReturnType<BrowserClient["auth"]["getSession"]>>["data"]["session"]; stop: () => void }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) await supabase.realtime.setAuth(session.access_token);

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, nextSession) => {
    if (nextSession?.access_token && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
      void supabase.realtime.setAuth(nextSession.access_token);
    }
  });

  return { session, stop: () => subscription.unsubscribe() };
}
