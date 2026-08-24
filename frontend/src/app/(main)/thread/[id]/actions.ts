"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function sendMessage(threadId: string, content: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not logged in" };
  }

  const { error } = await supabase.from("messages").insert({
    thread_id: threadId,
    sender_type: "user",
    sender_id: user.id,
    content,
  });

  if (error) {
    console.error("Error sending message:", error);
    return { error: error.message };
  }

  revalidatePath(`/thread/${threadId}`);
  return { success: true };
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
