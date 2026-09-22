import { ArrowUpRight, Pin, Sparkles, Users } from "lucide-react";
import { Logo } from "@/components/Logo";

const riseClass = "animate-rise motion-reduce:animate-none";

// This panel is always dark (bg-panel is dark in both themes, by design), so it can't
// use the theme-flipping --color-team etc. utilities — in light mode those resolve to
// the darker navy meant for a white background, which reads low-contrast here. Fixed
// hex matching the app's own dark-mode tokens (DESIGN.md 3.2) instead, applied via
// inline style rather than Tailwind arbitrary-value classes, since Tailwind can't see
// classes built from a JS variable at build time.
const NAVY = "#7FA8E0";
const DECISION = "#E9A94B";
const PRIVATE = "#4CC38A";

function Avatar({ initials, opacity }: { initials: string; opacity: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ backgroundColor: `rgb(255 255 255 / ${opacity})` }}
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
            `radial-gradient(circle at 78% 18%, rgb(127 168 224 / 0.26), transparent 42%), radial-gradient(circle at 12% 88%, rgb(59 111 179 / 0.18), transparent 38%), radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)`,
          backgroundSize: "auto, auto, 22px 22px",
        }}
      />
      <span aria-hidden="true" className="pointer-events-none absolute -right-28 -top-28 text-white/[0.06]">
        <Logo className="size-[520px]" />
      </span>

      <p className="relative inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIVATE }} aria-hidden="true" />
        Multiplayer AI for teams
      </p>

      <div className="relative my-10 w-full max-w-[460px] self-center" aria-hidden="true">
        <div className="rounded-panel border border-white/10 bg-white/[0.045] p-4 shadow-float">
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                className="flex size-6 items-center justify-center rounded-control"
                style={{ backgroundColor: `${NAVY}33`, color: NAVY }}
              >
                <Users size={13} />
              </span>
              Team Space
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/60">
              <span className="flex -space-x-1">
                <span className="size-4 rounded-full ring-2 ring-panel" style={{ backgroundColor: "rgb(255 255 255 / 0.75)" }} />
                <span className="size-4 rounded-full ring-2 ring-panel" style={{ backgroundColor: "rgb(255 255 255 / 0.55)" }} />
                <span className="size-4 rounded-full ring-2 ring-panel" style={{ backgroundColor: "rgb(255 255 255 / 0.35)" }} />
              </span>
              3 online
            </div>
          </div>

          <ul className="flex flex-col gap-3.5 text-[13.5px] leading-relaxed">
            <li className={`flex gap-2.5 ${riseClass}`} style={{ animationDelay: "150ms" }}>
              <Avatar initials="PS" opacity={0.18} />
              <div>
                <p className="text-xs font-medium text-white/60">Priya</p>
                <p className="text-white/90">Postgres or Firebase for the hackathon? We&rsquo;ve got 30 hours.</p>
              </div>
            </li>

            <li className={`flex gap-2.5 ${riseClass}`} style={{ animationDelay: "650ms" }}>
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: NAVY, color: "#0A0B10" }}
              >
                <Sparkles size={14} />
              </span>
              <div>
                <p className="text-xs font-medium" style={{ color: NAVY }}>Choir AI</p>
                <p className="text-white/90">
                  Postgres on Supabase. You already picked it for auth, and realtime comes free on that plan.
                </p>
              </div>
            </li>

            <li className={`flex gap-2.5 ${riseClass}`} style={{ animationDelay: "1150ms" }}>
              <Avatar initials="AK" opacity={0.28} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-xs font-medium text-white/60">
                  Arjun
                  <span className="inline-flex items-center gap-0.5" style={{ color: PRIVATE }}>
                    <ArrowUpRight size={11} /> shared from a private thread
                  </span>
                </p>
                <p
                  className="mt-1 rounded-control border px-3 py-2 text-white/90"
                  style={{ borderColor: `${NAVY}33`, backgroundColor: `${NAVY}14` }}
                >
                  Schema draft: users, teams, threads, messages. Auth handled by Supabase.
                </p>
              </div>
            </li>

            <li className={riseClass} style={{ animationDelay: "1650ms" }}>
              <p
                className="flex items-center gap-2 rounded-control border px-3 py-2 text-[13px]"
                style={{ borderColor: `${DECISION}40`, backgroundColor: `${DECISION}1A`, color: DECISION }}
              >
                <Pin size={13} className="shrink-0 fill-current" />
                <span className="font-medium">Decision</span>
                <span className="truncate opacity-80">Use Postgres on Supabase</span>
              </p>
            </li>
          </ul>
        </div>
      </div>

      <div className="relative max-w-md">
        <h2 className="font-display text-[34px] font-medium leading-[1.1] tracking-[-0.02em]">
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
