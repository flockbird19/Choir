import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";
import { getWorkspace } from "./queries";
import type { Thread } from "@/types/database";

export type SessionUser = Pick<User, "id" | "email" | "user_metadata">;

// Verifies the session token locally against the project's JWT signing keys, so a
// page doesn't wait on a round trip to the Supabase Auth server for every check.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const { claims } = data;
  return { id: claims.sub, email: claims.email, user_metadata: claims.user_metadata ?? {} };
});

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const { teams } = await getWorkspace(userId);
  return teams.some((team) => team.id === teamId);
}

// The workspace only contains threads the user may open (shared threads of their
// teams, their own private threads). Must stay in sync with verify_thread_access in
// backend/src/backend/db.py.
export async function getAccessibleThread(userId: string, threadId: string): Promise<Thread | null> {
  const { threads } = await getWorkspace(userId);
  return threads.find((thread) => thread.id === threadId) ?? null;
}
