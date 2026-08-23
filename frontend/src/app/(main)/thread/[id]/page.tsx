import { createClient } from "@/utils/supabase/server";
import { getMessages, getThreads } from "@/utils/supabase/queries";
import { ThreadView } from "@/components/chat/ThreadView";
import { redirect } from "next/navigation";
import { Thread, Message } from "@/types/database";

export default async function ThreadPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch current thread
  const { data: thread, error } = await supabase
    .from("threads")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !thread) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas text-ink p-8">
        <p>Thread not found or access denied.</p>
      </div>
    );
  }

  // Fetch messages
  const messages = await getMessages(id) || [];

  let sharedThread = null;
  let sharedMessages: Message[] = [];

  if (thread.type === "private") {
    // Need to find the shared thread for the same project
    const allProjectThreads = await getThreads(thread.project_id) as Thread[] || [];
    sharedThread = allProjectThreads.find((t: Thread) => t.type === "shared") || null;
    if (sharedThread) {
      sharedMessages = await getMessages(sharedThread.id) || [];
    }
  }

  return (
    <ThreadView 
      thread={thread}
      messages={messages}
      sharedThread={sharedThread}
      sharedMessages={sharedMessages}
    />
  );
}
