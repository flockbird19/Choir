import { createAdminClient } from "./admin";
import { getDisplayName } from "@/utils/display-name";

// Names live in auth user metadata, which only the admin API can read for other
// users. Cache them briefly so opening a thread doesn't re-fetch every teammate.
// TODO(L11/E4): replace with a `profiles` table once it exists in the schema script.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { name: string; cachedAt: number }>();

export function forgetMemberName(userId: string) {
  cache.delete(userId);
}

export async function getTeamMemberNames(teamId: string): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data: members, error } = await admin.from("team_members").select("user_id").eq("team_id", teamId);
  if (error || !members) {
    console.error("Error fetching team members:", error);
    return {};
  }

  const now = Date.now();
  const names: Record<string, string> = {};
  const missing: string[] = [];
  for (const { user_id: userId } of members) {
    const cached = cache.get(userId);
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) names[userId] = cached.name;
    else missing.push(userId);
  }

  await Promise.all(
    missing.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (!data.user) return;
      const name = getDisplayName(data.user);
      cache.set(userId, { name, cachedAt: now });
      names[userId] = name;
    })
  );

  return names;
}
