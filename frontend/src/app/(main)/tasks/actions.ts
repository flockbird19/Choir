"use server";

import { createClient } from "@/utils/supabase/server";
import { getCurrentUser } from "@/utils/supabase/access";

/** Feature D: a task to add, typed by hand or drafted by Suggest tasks. */
export interface TaskDraft {
  title: string;
  details?: string | null;
  source_message_ids?: string[];
  source_decision_ids?: string[];
  suggested_by_ai?: boolean;
}

type Result = { error?: string };

const UPDATE_PENDING = "The database needs its latest update. Ask the team owner to run schema.sql.";

function errorText(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "PGRST202" || error.code === "42P01") return UPDATE_PENDING;
  // The task functions raise plain sentences (schema.sql); show those, never raw database text.
  if ((error.code === "42501" || error.code === "P0001") && error.message) return error.message;
  return fallback;
}

async function call(fn: string, args: Record<string, unknown>, fallback: string): Promise<{ data?: unknown; error?: string }> {
  if (!(await getCurrentUser())) return { error: "Not logged in" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`Task action ${fn} failed:`, error);
    return { error: errorText(error, fallback) };
  }
  return { data };
}

export async function addTasks(projectId: string, drafts: TaskDraft[]): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not logged in" };
  const rows = drafts
    .map((d) => ({
      project_id: projectId,
      title: d.title.trim().slice(0, 200),
      details: d.details?.trim().slice(0, 2000) || null,
      source_message_ids: d.source_message_ids?.length ? d.source_message_ids : null,
      source_decision_ids: d.source_decision_ids?.length ? d.source_decision_ids : null,
      suggested_by_ai: !!d.suggested_by_ai,
      created_by: user.id,
    }))
    .filter((row) => row.title);
  if (rows.length === 0) return { error: "Give the task a title." };
  const supabase = await createClient();
  // One at a time: PostgREST bulk inserts need identical keys.
  for (const row of rows) {
    const { error } = await supabase.from("tasks").insert(row);
    if (error) {
      console.error("Adding a task failed:", error);
      return { error: errorText(error, "Couldn't add the task. Please try again.") };
    }
  }
  return {};
}

/** Returns who has the task now: you if your claim won, otherwise the teammate who got there first. */
export async function claimTask(taskId: string): Promise<Result & { claimedBy?: string }> {
  const { data, error } = await call("claim_task", { p_task_id: taskId }, "Couldn't claim the task.");
  return error ? { error } : { claimedBy: data as string };
}

export async function releaseTask(taskId: string): Promise<Result> {
  return { error: (await call("release_task", { p_task_id: taskId }, "Couldn't release the task.")).error };
}

export async function completeTask(taskId: string, result: string): Promise<Result> {
  const args = { p_task_id: taskId, p_result: result.trim().slice(0, 1000) };
  return { error: (await call("complete_task", args, "Couldn't mark the task done.")).error };
}

/** Feature D stage 2: send an agent's work back with a note; it's posted in the task thread as yours. */
export async function sendBackTask(taskId: string, note: string): Promise<Result> {
  const args = { p_task_id: taskId, p_note: note.trim().slice(0, 2000) };
  return { error: (await call("send_back_task", args, "Couldn't send it back.")).error };
}

export async function reopenTask(taskId: string): Promise<Result> {
  return { error: (await call("reopen_task", { p_task_id: taskId }, "Couldn't reopen the task.")).error };
}

export async function editTask(taskId: string, title: string, details: string | null): Promise<Result> {
  if (!title.trim()) return { error: "Give the task a title." };
  const args = { p_task_id: taskId, p_title: title.trim().slice(0, 200), p_details: details?.slice(0, 2000) ?? null };
  return { error: (await call("edit_task", args, "Couldn't save the task.")).error };
}

export async function deleteTask(taskId: string): Promise<Result> {
  return { error: (await call("delete_task", { p_task_id: taskId }, "Couldn't delete the task.")).error };
}
