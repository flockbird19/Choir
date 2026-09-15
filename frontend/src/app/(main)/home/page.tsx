import { getWorkspace } from "@/utils/supabase/queries";
import { getCurrentUser } from "@/utils/supabase/access";
import { getDisplayName } from "@/utils/display-name";
import { Logo } from "@/components/Logo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Lock, ArrowRight } from "lucide-react";
import { Thread } from "@/types/database";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspace(user.id);
  const activeTeam = workspace.teams[0] || null;
  const projects = workspace.projects.filter((p) => p.team_id === activeTeam?.id);
  const activeProject = projects[0] || null;
  const threads = workspace.threads.filter((t) => projects.some((p) => p.id === t.project_id));

  const sharedThread = threads.find((t: Thread) => t.type === "shared") || null;
  const privateThreads = threads.filter(
    (t: Thread) => t.type === "private" && t.owner_id === user.id
  );

  const firstName = getDisplayName(user).split(" ")[0];

  return (
    <div className="h-full flex flex-col items-center justify-center bg-canvas p-8 overflow-y-auto">
      <div className="max-w-md w-full flex flex-col items-center text-center">

        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-6">
          <Logo className="w-7 h-7 text-accent" />
        </div>

        <h1 className="font-serif text-4xl text-ink mb-2">
          Hello, {firstName}
        </h1>
        <p className="text-graphite text-base mb-10 leading-relaxed">
          {activeProject
            ? `You're in ${activeProject.name}. Pick a thread from the sidebar or jump in below.`
            : "Select a conversation from the sidebar to get started."}
        </p>

        <div className="w-full space-y-3">

          {sharedThread && (
            <Link
              href={`/thread/${sharedThread.id}`}
              className="group flex items-center gap-4 p-4 bg-shared-muted border border-shared/20
                hover:border-shared/50 rounded-xl transition-all hover:shadow-sm hover:shadow-shared/10"
            >
              <div className="w-10 h-10 rounded-xl bg-shared flex items-center justify-center shrink-0 shadow-sm shadow-shared/30">
                <Users size={18} className="text-white" aria-hidden="true" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-shared-fg">{sharedThread.name || "Team Space"}</p>
                <p className="text-xs text-shared/55">The shared conversation · everyone can see this</p>
              </div>
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="text-shared/30 group-hover:text-shared transition-all group-hover:translate-x-0.5 duration-150"
              />
            </Link>
          )}

          {privateThreads.length > 0 ? (
            <>
              <div className="pt-1">
                <p className="text-[11px] text-graphite uppercase tracking-widest font-semibold text-left px-1 mb-2">
                  Your threads
                </p>
                {privateThreads.slice(0, 4).map((thread: Thread) => (
                  <Link
                    key={thread.id}
                    href={`/thread/${thread.id}`}
                    className="group flex items-center gap-4 p-3.5 bg-surface border border-border
                      hover:border-graphite/30 rounded-xl transition-all hover:shadow-sm mb-2"
                  >
                    <div className="w-9 h-9 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
                      <Lock size={14} className="text-graphite" aria-hidden="true" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {thread.name || "Untitled Thread"}
                      </p>
                      <p className="text-[11px] text-graphite">
                        {new Date(thread.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    <ArrowRight
                      size={14}
                      aria-hidden="true"
                      className="text-graphite/30 group-hover:text-graphite transition-colors shrink-0"
                    />
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <div className="p-6 bg-surface border border-dashed border-border rounded-xl text-center mt-1">
              <Lock size={18} className="text-graphite/40 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm font-medium text-ink mb-0.5">No private threads yet</p>
              <p className="text-xs text-graphite leading-relaxed">
                Private threads are your personal scratch space to explore ideas with AI.
                Everything stays private unless you share it.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
