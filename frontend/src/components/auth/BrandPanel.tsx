import { ArrowUpRight, Pin, Sparkles, Users } from "lucide-react";
import { Logo } from "@/components/Logo";

const riseClass = "animate-rise motion-reduce:animate-none";

function Avatar({ initials, className }: { initials: string; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${className}`}
    >
      {initials}
    </span>
  );
}

export function BrandPanel() {
  return (
    <aside
      aria-label="What Choir does"
      className="relative hidden overflow-hidden bg-panel text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 78% 18%, rgb(129 140 248 / 0.28), transparent 42%), radial-gradient(circle at 12% 88%, rgb(99 102 241 / 0.18), transparent 38%), radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)",
          backgroundSize: "auto, auto, 22px 22px",
        }}
      />
      <span aria-hidden="true" className="pointer-events-none absolute -right-28 -top-28 text-white/[0.06]">
        <Logo className="size-[520px]" />
      </span>

      <p className="relative inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80">
        <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        Multiplayer AI for teams
      </p>

      <div className="relative my-10 w-full max-w-[460px] self-center" aria-hidden="true">
        <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-float">
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="flex size-6 items-center justify-center rounded-md bg-indigo-400/20 text-indigo-200">
                <Users size={13} />
              </span>
              Team Space
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/60">
              <span className="flex -space-x-1">
                <span className="size-4 rounded-full bg-rose-300 ring-2 ring-panel" />
                <span className="size-4 rounded-full bg-amber-300 ring-2 ring-panel" />
                <span className="size-4 rounded-full bg-sky-300 ring-2 ring-panel" />
              </span>
              3 online
            </div>
          </div>

          <ul className="flex flex-col gap-3.5 text-[13.5px] leading-relaxed">
            <li className={`flex gap-2.5 ${riseClass}`} style={{ animationDelay: "150ms" }}>
              <Avatar initials="PS" className="bg-rose-300 text-rose-950" />
              <div>
                <p className="text-xs font-medium text-white/60">Priya</p>
                <p className="text-white/90">Postgres or Firebase for the hackathon? We&rsquo;ve got 30 hours.</p>
              </div>
            </li>

            <li className={`flex gap-2.5 ${riseClass}`} style={{ animationDelay: "650ms" }}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-400 text-indigo-950">
                <Sparkles size={14} />
              </span>
              <div>
                <p className="text-xs font-medium text-indigo-200">Choir AI</p>
                <p className="text-white/90">
                  Postgres on Supabase. You already picked it for auth, and realtime comes free on that plan.
                </p>
              </div>
            </li>

            <li className={`flex gap-2.5 ${riseClass}`} style={{ animationDelay: "1150ms" }}>
              <Avatar initials="AK" className="bg-amber-300 text-amber-950" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-xs font-medium text-white/60">
                  Arjun
                  <span className="inline-flex items-center gap-0.5 text-indigo-200">
                    <ArrowUpRight size={11} /> shared from a private thread
                  </span>
                </p>
                <p className="mt-1 rounded-lg border border-indigo-300/20 bg-indigo-300/[0.08] px-3 py-2 text-white/90">
                  Schema draft: users, teams, threads, messages. Auth handled by Supabase.
                </p>
              </div>
            </li>

            <li className={riseClass} style={{ animationDelay: "1650ms" }}>
              <p className="flex items-center gap-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[13px] text-amber-100">
                <Pin size={13} className="shrink-0 fill-current" />
                <span className="font-medium">Decision</span>
                <span className="truncate text-amber-100/80">Use Postgres on Supabase</span>
              </p>
            </li>
          </ul>
        </div>
      </div>

      <div className="relative max-w-md">
        <h2 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]">
          Think privately.
          <br />
          Decide together.
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-white/70">
          One shared AI conversation for your whole team, plus private threads to explore on your own.
          Every decision stays where everyone can see it.
        </p>
      </div>
    </aside>
  );
}
