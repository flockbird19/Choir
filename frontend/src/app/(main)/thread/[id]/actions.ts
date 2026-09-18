"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getAccessibleThread, getCurrentUser } from "@/utils/supabase/access";
import { getWorkspace } from "@/utils/supabase/queries";
import { getTeamMemberNames } from "@/utils/supabase/member-names";
import { getDisplayName } from "@/utils/display-name";
import { revalidatePath } from "next/cache";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

const NO_THREAD_ACCESS = "You don't have access to this thread.";
const SHARED_THREAD_ONLY = "This action is only available in a shared thread you belong to.";
const DATABASE_UPDATE_PENDING = "This needs a database update that hasn't been applied yet. Please try again later.";

// Postgres 42703 / PostgREST PGRST204: a column isn't there yet (schema.sql not re-run).
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

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
  content: string,
  sourceThreadId?: string,
  // K3: the private thread's message ids at the time of publishing (the decision
  // trail). Prefer omitting/null over [] when there's nothing to point at.
  sourceMessageIds?: string[] | null
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

  // "Publish findings" (K2) links the post to the private thread it came from. Only your
  // own private thread in the same project can be the source.
  if (sourceThreadId) {
    const source = await getAccessibleThread(user.id, sourceThreadId);
    if (!source || source.type !== "private" || source.project_id !== target.project_id) {
      return { error: NO_THREAD_ACCESS };
    }
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
    ...(sourceThreadId ? { source_thread_id: sourceThreadId } : {}),
    ...(sourceMessageIds && sourceMessageIds.length > 0 ? { source_message_ids: sourceMessageIds } : {}),
  });

  if (isMissingColumn(error)) {
    console.error("Error posting to shared thread (database update pending):", error);
    return { error: DATABASE_UPDATE_PENDING };
  }
  if (error) {
    console.error("Error posting to shared thread:", error);
    return { error: error.message };
  }

  revalidatePath(`/thread/${sharedThreadId}`);
  return { success: true };
}

// ── "Discuss privately" (D2): start a private thread about a Team Space message ──

const FORK_NAME_MAX_CHARS = 40;

function forkThreadName(content: string): string {
  const text = content.replace(/[*_`#>|~[\]]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "Private discussion";
  return text.length > FORK_NAME_MAX_CHARS ? `${text.slice(0, FORK_NAME_MAX_CHARS).trimEnd()}…` : text;
}

export async function discussPrivately(
  sharedThreadId: string,
  messageId: string
): Promise<{ threadId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const shared = await getAccessibleThread(user.id, sharedThreadId);
  if (!shared || shared.type !== "shared") return { error: SHARED_THREAD_ONLY };

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("id, sender_type, sender_id, content")
    .eq("id", messageId)
    .eq("thread_id", sharedThreadId)
    .maybeSingle();
  if (!message) return { error: "That message no longer exists." };

  let author = "Choir AI";
  if (message.sender_type !== "assistant") {
    if (message.sender_id === user.id) {
      author = getDisplayName(user);
    } else {
      const project = (await getWorkspace(user.id)).projects.find((p) => p.id === shared.project_id);
      const names = project ? await getTeamMemberNames(project.team_id) : {};
      author = names[message.sender_id ?? ""] ?? "Former member";
    }
  }

  const { data: thread, error } = await supabase
    .from("threads")
    .insert({
      type: "private",
      owner_id: user.id,
      project_id: shared.project_id,
      name: forkThreadName(message.content),
      forked_from_message_id: message.id,
    })
    .select("id")
    .single();

  if (isMissingColumn(error)) {
    console.error("Error creating a private thread from a message (database update pending):", error);
    return { error: DATABASE_UPDATE_PENDING };
  }
  if (error || !thread) {
    console.error("Error creating a private thread from a message:", error);
    return { error: "Couldn't start a private thread. Please try again." };
  }

  const quoted = String(message.content)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const { error: seedError } = await supabase.from("messages").insert({
    thread_id: thread.id,
    sender_type: "user",
    sender_id: user.id,
    content: `Let's discuss this message from ${author} in ${shared.name || "Team Space"}:\n\n${quoted}`,
  });

  if (seedError) {
    console.error("Error seeding the new private thread:", seedError);
    await supabase.from("threads").delete().eq("id", thread.id).eq("owner_id", user.id);
    return { error: "Couldn't start a private thread. Please try again." };
  }

  revalidatePath("/");
  return { threadId: thread.id };
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

// ── AI auto-replies — mute/unmute in a private thread ─────────────────────────

export async function setThreadAutoReply(
  threadId: string,
  enabled: boolean
): Promise<{ success?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const thread = await getAccessibleThread(user.id, threadId);
  if (!thread || thread.type !== "private" || thread.owner_id !== user.id) {
    return { error: "AI replies can only be muted in your own private threads." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("threads")
    .update({ ai_auto_reply: enabled })
    .eq("id", threadId)
    .eq("owner_id", user.id)
    .select("id");

  if (isMissingColumn(error)) {
    console.error("Error saving AI reply setting (database update pending):", error);
    return { error: "Couldn't save this setting yet: the database update for AI replies hasn't been applied." };
  }
  if (error) {
    console.error("Error saving AI reply setting:", error);
    return { error: "Couldn't save the AI reply setting. Please try again." };
  }
  // No row changed: the access rule allowing this update isn't in place.
  if (!data || data.length === 0) {
    return { error: "Couldn't save the AI reply setting. Please try again." };
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

// ── K3 decision trail ────────────────────────────────────────────────────────
// The trail's author and "from X's private exploration" line come straight off the
// message the caller already has (shared_by / sender). Only the model needs a lookup:
// the private thread that fed a Decision is invisible to teammates other than its
// owner under RLS, so reading its messages' model_name needs the admin client, scoped
// to exactly the ids this Decision's own source_message_ids points at.
export async function getDecisionTrailModels(sharedMessageId: string): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("source_message_ids")
    .eq("id", sharedMessageId)
    .maybeSingle();
  const sourceIds = message?.source_message_ids as string[] | null | undefined;
  if (!sourceIds || sourceIds.length === 0) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("model_name")
    .in("id", sourceIds)
    .eq("sender_type", "assistant")
    .not("model_name", "is", null);

  if (error || !data) return [];
  return [...new Set(data.map((m) => m.model_name as string))];
}

// ── E5 "Seen by" ───────────────────────────────────────────────────────────
// `last_read_at` is separate from `last_seen_at` (the Catch me up position) and is
// never touched here.

export async function markThreadSeen(threadId: string): Promise<{ success?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  if (!(await getAccessibleThread(user.id, threadId))) {
    return { error: NO_THREAD_ACCESS };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("thread_reads")
    .upsert(
      { thread_id: threadId, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: "thread_id,user_id" }
    );

  if (isMissingColumn(error)) return { error: DATABASE_UPDATE_PENDING };
  if (error) {
    console.error("Error marking thread seen:", error);
    return { error: error.message };
  }
  return { success: true };
}

// Teammates who have seen a shared thread, as { userId: last_read_at }. Uses the admin
// client: everyone's own read position is private under RLS ("Manage own read state"
// only exposes your own row), so seeing teammates' requires the service key, same as
// team member names do.
export async function getThreadSeenBy(threadId: string): Promise<Record<string, string>> {
  const user = await getCurrentUser();
  if (!user) return {};

  const thread = await getAccessibleThread(user.id, threadId);
  if (!thread || thread.type !== "shared") return {};

  const project = (await getWorkspace(user.id)).projects.find((p) => p.id === thread.project_id);
  if (!project) return {};

  const admin = createAdminClient();
  const { data: members } = await admin.from("team_members").select("user_id").eq("team_id", project.team_id);
  const memberIds = (members ?? []).map((m) => m.user_id as string);
  if (memberIds.length === 0) return {};

  const { data, error } = await admin
    .from("thread_reads")
    .select("user_id, last_read_at")
    .eq("thread_id", threadId)
    .in("user_id", memberIds)
    .not("last_read_at", "is", null);

  if (error || !data) return {};

  const seenBy: Record<string, string> = {};
  for (const row of data) {
    if (row.last_read_at) seenBy[row.user_id as string] = row.last_read_at as string;
  }
  return seenBy;
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
