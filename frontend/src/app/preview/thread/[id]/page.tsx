import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { ThreadScreen } from "@/components/thread-v2/ThreadScreen";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getAccessibleThread, getCurrentUser } from "@/utils/supabase/access";
import { getDisplayName } from "@/utils/display-name";
import { getMessages, getWorkspace } from "@/utils/supabase/queries";
import type { Message } from "@/types/database";

// Preview of the redesigned thread view (E2 checkpoint). Same data and access checks as
// app/(main)/thread/[id]/page.tsx; the classic view stays the default until the rollout.

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  const thread = user ? await getAccessibleThread(user.id, id) : null;
  const name = thread ? thread.name || (thread.type === "private" ? "Private thread" : "Team Space") : "Thread not found";
  return { title: `${name} (preview) — Choir` };
}

export default async function PreviewThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/preview/thread/${id}`);

  const workspace = await getWorkspace(user.id);
  if (workspace.teams.length === 0) redirect("/onboarding");

  const thread = await getAccessibleThread(user.id, id);
  if (!thread) {
    return (
      <main data-ds className="flex h-full items-center justify-center bg-bg font-body text-fg">
        <EmptyState
          icon={<Lock />}
          title="Thread not found"
          description="It may have been deleted, or you don't have access to it."
          action={
            <Link href="/preview" className={buttonClasses({ variant: "primary" })}>
              Go to your team&rsquo;s shared thread
            </Link>
          }
        />
      </main>
    );
  }

  const sharedThread =
    thread.type === "private"
      ? workspace.threads.find((t) => t.project_id === thread.project_id && t.type === "shared") ?? null
      : null;

  const [messages, sharedMessages]: [Message[], Message[]] = await Promise.all([
    getMessages(id),
    sharedThread ? getMessages(sharedThread.id) : Promise.resolve([]),
  ]);

  return (
    <ThreadScreen
      key={thread.id}
      user={{ id: user.id, name: getDisplayName(user), email: user.email }}
      teams={workspace.teams}
      projects={workspace.projects}
      threads={workspace.threads}
      thread={thread}
      messages={messages}
      sharedThread={sharedThread}
      sharedMessages={sharedMessages}
    />
  );
}
