"use server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getAccessibleThread, getCurrentUser } from "@/utils/supabase/access";
import { getDecisions, getMessagesBefore, getWorkspace } from "@/utils/supabase/queries";
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

export async function sendMessage(
  threadId: string,
  content: string,
  messageId?: string,
  replyToMessageId?: string
) {
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
    reply_to_message_id?: string;
  } = {
    thread_id: threadId,
    sender_type: "user",
    sender_id: user.id,
    content,
  };

  if (messageId) {
    insertData.id = messageId;
  }
  if (replyToMessageId) {
    insertData.reply_to_message_id = replyToMessageId;
  }

  const { data, error } = await supabase.from("messages").insert(insertData).select().single();

  if (isMissingColumn(error) && replyToMessageId) {
    // The reply column isn't there yet (schema.sql not re-run) — send the message
    // without it rather than blocking the send entirely.
    delete insertData.reply_to_message_id;
    const retry = await supabase.from("messages").insert(insertData).select().single();
    if (retry.error) {
      console.error("Error sending message:", retry.error);
      return { error: retry.error.message };
    }
    return { success: true, messageId: retry.data.id };
  }
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

// M1/M2 spike: connect a coding agent (Claude Code, Cursor, Codex...) to a project.
export async function connectAgent(
  projectId: string,
  kind: string
): Promise<{ token?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Not logged in" };

  const res = await fetch(`${BACKEND_URL}/api/agents/connect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project_id: projectId, kind }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    return { error: json.detail ?? "Failed to connect an agent." };
  }
  const json = await res.json();
  return { token: json.token };
}

export async function postToSharedThread(
  sharedThreadId: string,
  content: string,
  sourceThreadId?: string,
  // K3: the private thread's message ids at the time of publishing (the decision
  // trail). Prefer omitting/null over [] when there's nothing to point at.
  sourceMessageIds?: string[] | null,
  // The user changed the selected messages before posting, so it isn't an unchanged quote.
  publishEdited = false
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
    ...(publishEdited ? { publish_edited: true } : {}),
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

const FORK_NAME_MAX_CHARS = 50;

// A hard character cut sliced mid-word ("...function: p…"), which reads as
// broken rather than shortened. Back up to the last whole word instead, so a
// thread title always ends cleanly, at some real cost in exact length control.
function forkThreadName(content: string): string {
  const text = content.replace(/[*_`#>|~[\]]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "Private discussion";
  if (text.length <= FORK_NAME_MAX_CHARS) return text;
  const cut = text.slice(0, FORK_NAME_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  // Keep at least half the budget even if the first "word" is unusually long
  // (e.g. a URL or code token), rather than truncating to almost nothing.
  const boundary = lastSpace > FORK_NAME_MAX_CHARS / 2 ? lastSpace : FORK_NAME_MAX_CHARS;
  return `${cut.slice(0, boundary).trimEnd()}…`;
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
  // A withdrawn publication has no text left to discuss.
  if (!message.content) return { error: "That post was withdrawn." };

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

// ── Withdraw a publication (curation) ────────────────────────────────────────
// The database function checks it's your own post from a private thread, clears its
// text, unpins it and drops the stored AI summary. Live update reaches other tabs.

// ── Project memory (component #4) ─────────────────────────────────────────────
// The whole team edits it in their own name (RLS: members only, updated_by = you). A note
// stays "by AI" only while its text is exactly what the AI wrote; any edit makes it yours,
// and the AI never changes a person's note. A version check stops two edits clobbering.

const MEMORY_SECTIONS = ["goal", "facts", "open", "owners"] as const;
export type MemorySection = (typeof MEMORY_SECTIONS)[number];
export interface MemoryNote {
  id: string;
  section: MemorySection;
  text: string;
  sources: string[];
  by: string;
}
const MAX_MEMORY_NOTES = 120; // people's notes plus up to 50 AI notes (memory.py)
const MAX_NOTE_CHARS = 700; // matches memory.MAX_ITEM_CHARS

export async function saveProjectMemory(
  projectId: string,
  notes: MemoryNote[],
  expectedVersion: number | null
): Promise<{ items?: MemoryNote[]; version?: number; error?: string; conflict?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };
  if (!Array.isArray(notes) || notes.length > MAX_MEMORY_NOTES) return { error: `Project memory holds up to ${MAX_MEMORY_NOTES} notes.` };

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("project_memory")
    .select("items, version")
    .eq("project_id", projectId)
    .maybeSingle();
  if (isMissingColumn(readError) || readError?.code === "PGRST205") return { error: DATABASE_UPDATE_PENDING };
  if (readError) return { error: "Couldn't load project memory. Please try again." };
  if ((current?.version ?? null) !== expectedVersion) {
    return { error: "Someone else just changed project memory, so it's been reloaded. Try again.", conflict: true };
  }

  // A note keeps its author (the AI or a teammate) only while its text is unchanged;
  // anything new or edited is credited to whoever saves it.
  const existing = new Map(((current?.items as MemoryNote[] | undefined) ?? []).map((n) => [n.id, n]));
  const items: MemoryNote[] = [];
  for (const note of notes) {
    const text = String(note?.text ?? "").trim().slice(0, MAX_NOTE_CHARS);
    if (!text || !MEMORY_SECTIONS.includes(note.section)) continue;
    const id = String(note.id || crypto.randomUUID()).slice(0, 64);
    const before = existing.get(id);
    items.push({
      id,
      section: note.section,
      text,
      sources: Array.isArray(note.sources) ? note.sources.map(String).slice(0, 20) : [],
      by: before && before.text === text ? before.by : user.id,
    });
  }

  const now = new Date().toISOString();
  const { data, error } = current
    ? await supabase
        .from("project_memory")
        .update({ items, version: current.version + 1, updated_by: user.id, updated_at: now })
        .eq("project_id", projectId)
        .eq("version", current.version)
        .select("items, version")
    : await supabase
        .from("project_memory")
        .insert({ project_id: projectId, items, version: 1, updated_by: user.id })
        .select("items, version");
  if (error) {
    console.error("Error saving project memory:", error);
    return { error: "Couldn't save project memory. Please try again." };
  }
  // No row back: someone saved in between (the version moved), or RLS refused it.
  if (!data || data.length === 0) {
    return { error: "Someone else just changed project memory, so it's been reloaded. Try again.", conflict: true };
  }
  return { items: data[0].items as MemoryNote[], version: data[0].version as number };
}

export async function withdrawPublication(messageId: string): Promise<{ success?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_publication", { p_message_id: messageId });
  if (error) {
    console.error("Error withdrawing a post:", error);
    if (error.code === "PGRST202") return { error: DATABASE_UPDATE_PENDING };
    if (error.code === "42501") return { error: "You can only withdraw your own posts from a private thread." };
    return { error: "Couldn't withdraw the post. Please try again." };
  }
  return { success: true };
}

// ── "AI replies" / "AI waits" in a private thread ─────────────────────────────

export async function setThreadAutoReply(
  threadId: string,
  enabled: boolean
): Promise<{ success?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const thread = await getAccessibleThread(user.id, threadId);
  if (!thread || thread.type !== "private" || thread.owner_id !== user.id) {
    return { error: "You can only change AI replies in your own private threads." };
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

const MAX_THREAD_NAME_LENGTH = 80;

// L16: renames a thread the caller can access — their own private thread, or (new,
// needs schema.sql's "Team members can rename shared threads" re-run) the shared
// Team Space thread, on behalf of the whole team.
export async function renameThread(
  threadId: string,
  name: string
): Promise<{ success?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the thread a name." };
  if (trimmed.length > MAX_THREAD_NAME_LENGTH) {
    return { error: `Keep the name under ${MAX_THREAD_NAME_LENGTH} characters.` };
  }

  const thread = await getAccessibleThread(user.id, threadId);
  if (!thread) return { error: "Couldn't find that thread." };
  if (thread.type === "private" && thread.owner_id !== user.id) {
    return { error: "Only the owner can rename this private thread." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("threads")
    .update({ name: trimmed })
    .eq("id", threadId)
    .select("id, name");

  if (isMissingColumn(error)) {
    console.error("Error renaming thread (database update pending):", error);
    return { error: DATABASE_UPDATE_PENDING };
  }
  if (error) {
    console.error("Error renaming thread:", error);
    return { error: "Couldn't rename the thread. Please try again." };
  }
  // Live-tested finding: when the "name" column isn't in the update grant yet
  // (schema.sql not re-run), PostgREST doesn't error — it just drops the
  // disallowed field from the SET clause, so this still "succeeds" and returns
  // the row with its OLD name unchanged. Check the returned value actually
  // matches what we asked for, not just that a row came back.
  if (!data || data.length === 0 || data[0].name !== trimmed) {
    console.error("Rename didn't take effect (likely the update grant on threads.name isn't applied yet):", data);
    return { error: DATABASE_UPDATE_PENDING };
  }

  revalidatePath(`/thread/${threadId}`);
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

// ── C3 pagination ────────────────────────────────────────────────────────────

export async function loadOlderMessages(threadId: string, beforeCreatedAt: string) {
  const user = await getCurrentUser();
  if (!user || !(await getAccessibleThread(user.id, threadId))) return [];
  return getMessagesBefore(threadId, beforeCreatedAt);
}

// Decisions are shown regardless of how far "load older" has paged back, so they're
// fetched on their own rather than filtered out of the loaded page.
export async function getThreadDecisions(threadId: string) {
  const user = await getCurrentUser();
  if (!user || !(await getAccessibleThread(user.id, threadId))) return [];
  return getDecisions(threadId);
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
  const now = new Date().toISOString();

  // Not a plain upsert: PostgREST's ON CONFLICT DO UPDATE rewrites every column in
  // the payload, including thread_id/user_id, but the grant on this table only
  // covers last_seen_at/last_read_at — update the row directly, and only insert a
  // fresh one when there isn't one yet.
  const { data: updated, error: updateError } = await supabase
    .from("thread_reads")
    .update({ last_read_at: now })
    .eq("thread_id", threadId)
    .eq("user_id", user.id)
    .select("thread_id");

  if (isMissingColumn(updateError)) return { error: DATABASE_UPDATE_PENDING };
  if (updateError) {
    console.error("Error marking thread seen:", updateError);
    return { error: updateError.message };
  }
  if (updated && updated.length > 0) return { success: true };

  const { error: insertError } = await supabase
    .from("thread_reads")
    .insert({ thread_id: threadId, user_id: user.id, last_read_at: now });

  if (isMissingColumn(insertError)) return { error: DATABASE_UPDATE_PENDING };
  if (insertError) {
    console.error("Error marking thread seen:", insertError);
    return { error: insertError.message };
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
