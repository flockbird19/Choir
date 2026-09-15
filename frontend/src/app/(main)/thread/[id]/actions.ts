"use server";

import { createClient } from "@/utils/supabase/server";
import { getAccessibleThread, getCurrentUser } from "@/utils/supabase/access";
import { getWorkspace } from "@/utils/supabase/queries";
import { getTeamMemberNames } from "@/utils/supabase/member-names";
import { getDisplayName } from "@/utils/display-name";
import { revalidatePath } from "next/cache";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

const NO_THREAD_ACCESS = "You don't have access to this thread.";
const SHARED_THREAD_ONLY = "This action is only available in a shared thread you belong to.";

// Display names of everyone who can post in a thread, keyed by user id.
export async function getThreadMemberNames(threadId: string): Promise<Record<string, string>> {
  const user = await getCurrentUser();
  if (!user) return {};

  const thread = await getAccessibleThread(user.id, threadId);
  if (!thread) return {};

  const self = { [user.id]: getDisplayName(user) };
  if (thread.type === "private") return self;

  const project = (await getWorkspace(user.id)).projects.find((p) => p.id === thread.project_id);
  if (!project) return self;

  // Your own name comes from your session so a rename shows up immediately.
  return { ...(await getTeamMemberNames(project.team_id)), ...self };
}

export async function sendMessage(threadId: string, content: string, messageId?: string) {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not logged in" };
  }

  if (!(await getAccessibleThread(user.id, threadId))) {
    return { error: NO_THREAD_ACCESS };
  }

  const insertData: {
    id?: string;
    thread_id: string;
    sender_type: "user";
    sender_id: string;
    content: string;
  } = {
    thread_id: threadId,
    sender_type: "user",
    sender_id: user.id,
    content,
  };

  if (messageId) {
    insertData.id = messageId;
  }

  const { data, error } = await supabase.from("messages").insert(insertData).select().single();

  if (error) {
    console.error("Error sending message:", error);
    return { error: error.message };
  }

  // Removed revalidatePath to prevent full-page reload on every message
  return { success: true, messageId: data.id };
}

export async function getSessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// ── BYOK Key Management (called from Settings page) ──────────────────────────

export async function getSavedProviders(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];

  const res = await fetch(`${BACKEND_URL}/api/keys`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.saved_providers ?? [];
}

export async function saveApiKey(
  provider: string,
  apiKey: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not logged in" };

  const res = await fetch(`${BACKEND_URL}/api/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    return { error: json.detail ?? "Failed to save key." };
  }
  revalidatePath("/settings");
  return { success: true };
}

export async function deleteApiKey(
  provider: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not logged in" };

  const res = await fetch(`${BACKEND_URL}/api/keys/${provider}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    return { error: json.detail ?? "Failed to delete key." };
  }
  revalidatePath("/settings");
  return { success: true };
}

export async function postToSharedThread(
  sharedThreadId: string,
  content: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not logged in" };
  }

  const target = await getAccessibleThread(user.id, sharedThreadId);
  if (!target || target.type !== "shared") {
    return { error: SHARED_THREAD_ONLY };
  }

  // Insert the compiled markdown block into the shared thread.
  // We set `shared_by` to the current user's ID so the frontend can display
  // the "Shared from private exploration" banner.
  const { error } = await supabase.from("messages").insert({
    thread_id: sharedThreadId,
    sender_type: "user",
    sender_id: user.id,
    content,
    shared_by: user.id,
  });

  if (error) {
    console.error("Error posting to shared thread:", error);
    return { error: error.message };
  }

  revalidatePath(`/thread/${sharedThreadId}`);
  return { success: true };
}

// ── Global Decisions — pin/unpin a shared-thread message ──────────────────────
// No revalidatePath here: the Decisions panel and message list update live via
// the useRealtimeMessages UPDATE subscription, so a full route revalidation
// would just be redundant (and would fight the optimistic local state).

export async function pinMessage(
  threadId: string,
  messageId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not logged in" };
  }

  const thread = await getAccessibleThread(user.id, threadId);
  if (!thread || thread.type !== "shared") {
    return { error: SHARED_THREAD_ONLY };
  }

  const { error } = await supabase
    .from("messages")
    .update({ is_decision: true, pinned_by: user.id, pinned_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("thread_id", threadId);

  if (error) {
    console.error("Error pinning message:", error);
    return { error: error.message };
  }

  return { success: true };
}

export async function unpinMessage(
  threadId: string,
  messageId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not logged in" };
  }

  const thread = await getAccessibleThread(user.id, threadId);
  if (!thread || thread.type !== "shared") {
    return { error: SHARED_THREAD_ONLY };
  }

  const { error } = await supabase
    .from("messages")
    .update({ is_decision: false, pinned_by: null, pinned_at: null })
    .eq("id", messageId)
    .eq("thread_id", threadId);

  if (error) {
    console.error("Error unpinning message:", error);
    return { error: error.message };
  }

  return { success: true };
}

export async function createThread(projectId: string, name: string) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const { projects } = await getWorkspace(user.id);
  if (!projects.some((p) => p.id === projectId)) {
    return { error: "You don't have access to this project." };
  }

  const { data, error } = await supabase.from("threads").insert({
    type: "private",
    owner_id: user.id,
    project_id: projectId,
    name,
  }).select().single();

  if (error) {
    console.error("Error creating thread:", error);
    return { error: error.message };
  }

  revalidatePath("/");
  return { success: true, threadId: data.id };
}

export async function deleteThread(threadId: string) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const { error } = await supabase.from("threads")
    .delete()
    .eq("id", threadId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("Error deleting thread:", error);
    return { error: error.message };
  }

  revalidatePath("/");
  return { success: true };
}
