import { ArrowUp, ArrowUpRight, AtSign, Hash, Lock, Pin, Search, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";

const rise = "animate-rise motion-reduce:animate-none";

/** Static illustration of a shared thread, built from the same tokens as the real thread view. */
export function ProductMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-sheet border border-line bg-card text-left shadow-float",
        className
      )}
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-line bg-sunken px-3.5">
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="mx-auto hidden items-center gap-1.5 rounded-md border border-line bg-card px-2.5 py-0.5 text-caption text-fg-subtle sm:flex">
          <Search size={11} /> Search threads and messages <span className="font-mono">⌘K</span>
        </span>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="hidden w-48 shrink-0 flex-col gap-4 border-r border-line bg-sunken p-3 md:flex">
          <div className="flex items-center gap-2 px-1">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-caption font-bold text-on-primary">HT</span>
            <span className="truncate text-label font-semibold text-fg">Hackathon team</span>
          </div>
          <div className="flex flex-col gap-1">
            <p className="px-1 text-caption font-semibold uppercase tracking-wider text-fg-subtle">Shared</p>
            <span className="flex items-center gap-2 rounded-md bg-card px-2 py-1.5 text-label font-medium text-fg shadow-soft">
              <Users size={13} className="text-team" /> Team Space
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <p className="px-1 text-caption font-semibold uppercase tracking-wider text-fg-subtle">Your private threads</p>
            {["Auth ideas", "Pitch draft", "Schema"].map((name) => (
              <span key={name} className="flex items-center gap-2 px-2 py-1.5 text-label text-fg-muted">
                <Lock size={12} className="text-private" /> {name}
              </span>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Hash size={15} className="shrink-0 text-team" />
              <span className="truncate font-display text-body-sm font-semibold text-fg">Team Space</span>
              <Badge tone="shared" icon={<Users />}>Shared</Badge>
            </div>
            <span className="flex -space-x-1.5">
              <Avatar name="Priya S" colorKey="priya" size="xs" className="ring-2 ring-card" />
              <Avatar name="Arjun K" colorKey="arjun-k" size="xs" className="ring-2 ring-card" />
            </span>
          </div>

          <div className="flex flex-col gap-4 px-4 py-4 text-body-sm sm:text-[13.5px]">
            <div className={cn("flex gap-2.5", rise)} style={{ animationDelay: "120ms" }}>
              <Avatar name="Priya S" colorKey="priya" size="sm" />
              <div className="min-w-0">
                <p className="text-caption"><span className="font-semibold text-fg">Priya</span> <span className="text-fg-subtle">10:02</span></p>
                <p className="mt-1 w-fit rounded-bubble rounded-tl-md border border-line bg-card px-3 py-2 text-fg">
                  Postgres or Firebase for this weekend? We have 30 hours.
                </p>
              </div>
            </div>

            <div className={cn("flex justify-end", rise)} style={{ animationDelay: "420ms" }}>
              <p className="max-w-[85%] rounded-bubble rounded-tr-md border border-bubble-own-line bg-bubble-own px-3 py-2 text-fg">
                <span className="font-medium text-primary">@AI</span> which fits what we already have?
              </p>
            </div>

            <div className={cn("flex gap-2.5", rise)} style={{ animationDelay: "720ms" }}>
              <Avatar name="Choir AI" kind="ai" size="sm" />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-caption">
                  <span className="font-semibold text-fg">Choir AI</span>
                  <Badge tone="ai" mono>claude-haiku-4-5</Badge>
                </p>
                <p className="mt-1 text-fg">
                  Postgres on Supabase. The team already chose it for sign-in, and live updates come with it.
                </p>
              </div>
            </div>

            <div className={cn("flex gap-2.5", rise)} style={{ animationDelay: "1020ms" }}>
              <Avatar name="Arjun K" colorKey="arjun-k" size="sm" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-1.5 text-caption">
                  <span className="font-semibold text-fg">Arjun</span>
                  <span className="inline-flex items-center gap-0.5 text-team"><ArrowUpRight size={12} /> shared from a private thread</span>
                </p>
                <p className="mt-1 rounded-bubble rounded-tl-md border border-team-line bg-team-soft px-3 py-2 text-fg">
                  Schema draft: users, teams, threads, messages.
                </p>
              </div>
            </div>

            <div
              className={cn("flex items-center gap-2 rounded-control border border-decision-line bg-decision-soft px-3 py-2 text-label text-decision", rise)}
              style={{ animationDelay: "1320ms" }}
            >
              <Pin size={13} className="shrink-0 fill-current" />
              <span className="font-semibold">Decision</span>
              <span className="truncate text-fg-muted">Use Postgres on Supabase</span>
            </div>
          </div>

          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 rounded-card border border-primary/40 bg-card px-3 py-2 shadow-soft ring-4 ring-primary/10">
              <span className="min-w-0 flex-1 truncate text-body-sm text-fg-subtle">Message Team Space</span>
              <span className="hidden items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-caption font-medium text-primary sm:inline-flex">
                <AtSign size={11} /> AI
              </span>
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-on-primary">
                <ArrowUp size={14} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
