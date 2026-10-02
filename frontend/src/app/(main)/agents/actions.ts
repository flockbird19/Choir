"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUser } from "@/utils/supabase/access";

type Result = { error?: string };

/**
 * Feature D stage 2: the "Allow" page records which project a coding tool works on before it
 * approves the sign-in. Connecting the same tool again moves it to the new project.
 */
export async function connectAgent(clientId: string, clientName: string, projectId: string): Promise<Result> {
  if (!(await getCurrentUser())) return { error: "Sign in again to continue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("connect_agent", {
    p_client_id: clientId,
    p_client_name: clientName,
    p_project_id: projectId,
  });
  if (error) {
    console.error("connect_agent failed:", error);
    return { error: "Choir couldn't connect this tool to that project. Pick one of your projects and try again." };
  }
  return {};
}

/** Settings → Connect your AI: the tool's next call fails with "This connection was removed in Choir". */
export async function disconnectAgent(grantId: string): Promise<Result> {
  if (!(await getCurrentUser())) return { error: "Sign in again to continue." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .select("client_id");
  if (error || !data?.length) {
    console.error("disconnectAgent failed:", error);
    return { error: "Couldn't disconnect it. Refresh the page and try again." };
  }
  // Also withdraw Supabase's own approval (and the tool's refresh tokens), so connecting again
  // shows the Allow page instead of being approved silently against a removed connection.
  const { error: revokeError } = await supabase.auth.oauth.revokeGrant({ clientId: data[0].client_id });
  if (revokeError) console.error("revokeGrant failed (the Choir connection is still removed):", revokeError);
  revalidatePath("/settings");
  return {};
}
