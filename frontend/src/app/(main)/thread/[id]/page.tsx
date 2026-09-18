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
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ catchup?: string | string[] }>;
}) {
  const [{ id }, { catchup }] = await Promise.all([params, searchParams]);

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // The access check and the thread's own messages don't depend on each other (both
  // only need `id` from the URL), so run them together instead of one after the other.
  // RLS scopes `messages` to threads this session can see either way, so nothing is
  // exposed before `thread` is confirmed below.
  const [thread, messages] = await Promise.all([
    getAccessibleThread(user.id, id),
    getMessages(id),
  ]);

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

  const sharedMessages: Message[] = sharedThread ? await getMessages(sharedThread.id) : [];

  return (
    <ThreadView
      // A fresh view per thread, so per-thread state (mute, banners, drafts) never leaks across.
      key={thread.id}
      thread={thread}
      messages={messages}
      sharedThread={sharedThread}
      sharedMessages={sharedMessages}
      currentUserId={user.id}
      currentUserName={getDisplayName(user)}
      // Set by the invite flow (?catchup=1) so newcomers get a digest of what they missed.
      autoCatchUp={thread.type === "shared" && catchup === "1"}
    />
  );
}
