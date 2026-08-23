"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

export async function sendMessage(threadId: string, content: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { error: "Not logged in" };
  }

  const { error } = await supabase
    .from("messages")
    .insert({
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
