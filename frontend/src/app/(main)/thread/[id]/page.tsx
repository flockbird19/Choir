import { getMessages, getWorkspace } from "@/utils/supabase/queries";
import { getAccessibleThread, getCurrentUser } from "@/utils/supabase/access";
import { getDisplayName } from "@/utils/display-name";
import { ThreadView } from "@/components/chat/ThreadView";
import { redirect } from "next/navigation";
import { Thread, Message } from "@/types/database";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  const thread = user ? await getAccessibleThread(user.id, id) : null;

  if (!thread) {
    return { title: "Thread Not Found — Choir" };
  }

  const title = thread.name || (thread.type === "private" ? "Private Thread" : "Team Space");
  return {
    title: `${title} — Choir`,
    description: `View the ${title} thread in your Choir workspace.`,
  };
}

export default async function ThreadPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const thread = await getAccessibleThread(user.id, id);

  if (!thread) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas text-ink p-8">
        <p>Thread not found or access denied.</p>
      </div>
    );
  }

  // Same request-scoped workspace the layout and access check already loaded.
  const sharedThread: Thread | null =
    thread.type === "private"
      ? (await getWorkspace(user.id)).threads.find(
          (t) => t.project_id === thread.project_id && t.type === "shared"
        ) ?? null
      : null;

  const [messages, sharedMessages]: [Message[], Message[]] = await Promise.all([
    getMessages(id),
    sharedThread ? getMessages(sharedThread.id) : Promise.resolve([]),
  ]);

  return (
    <ThreadView
      thread={thread}
      messages={messages}
      sharedThread={sharedThread}
      sharedMessages={sharedMessages}
      currentUserId={user.id}
      currentUserName={getDisplayName(user)}
    />
  );
}
