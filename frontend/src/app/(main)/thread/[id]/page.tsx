import { getMessages, getWorkspace, getSeenOnboardingTour, getTeamSpaceSeenSince } from "@/utils/supabase/queries";
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
  searchParams: Promise<{ catchup?: string | string[]; tour?: string | string[]; tasks?: string | string[] }>;
}) {
  const [{ id }, { catchup, tour, tasks }] = await Promise.all([params, searchParams]);

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
      <div className="h-full flex items-center justify-center bg-bg text-fg p-8">
        <p>Thread not found or access denied.</p>
      </div>
    );
  }

  // Same request-scoped workspace the layout and access check already loaded (no extra round trip).
  const workspace = await getWorkspace(user.id);
  const sharedThread: Thread | null =
    thread.type === "private"
      ? workspace.threads.find((t) => t.project_id === thread.project_id && t.type === "shared") ?? null
      : null;
  const teamId = workspace.projects.find((p) => p.id === thread.project_id)?.team_id;

  const [sharedMessages, teamSpaceSeenSince]: [Message[], string | null] = sharedThread
    ? await Promise.all([
        getMessages(sharedThread.id),
        teamId ? getTeamSpaceSeenSince(user.id, sharedThread.id, teamId) : Promise.resolve(null),
      ])
    : [[], null];

  // Only pay for this round trip when the tour was actually requested.
  const wantsTour = thread.type === "shared" && tour === "1";
  const alreadySeenTour = wantsTour ? await getSeenOnboardingTour(user.id) : true;

  return (
    <ThreadView
      // A fresh view per thread, so per-thread state (mute, banners, drafts) never leaks across.
      key={thread.id}
      thread={thread}
      messages={messages}
      sharedThread={sharedThread}
      sharedMessages={sharedMessages}
      teamSpaceSeenSince={teamSpaceSeenSince}
      currentUserId={user.id}
      currentUserName={getDisplayName(user)}
      // Set by the invite flow (?catchup=1) so newcomers get a digest of what they missed.
      autoCatchUp={thread.type === "shared" && catchup === "1"}
      // Set by onboarding's Ready screen (?tour=1), unless this account has
      // already clicked through the coach-mark tour before.
      startTour={wantsTour && !alreadySeenTour}
      isTeamOwner={!!teamId && workspace.ownedTeamIds.includes(teamId)}
      // Set by a task result in Cmd+K (?tasks=open): open the Tasks panel straight away.
      openTasks={tasks === "open"}
    />
  );
}
