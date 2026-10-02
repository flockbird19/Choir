import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

// Sign-in, sign-up, reset, invite and onboarding: one centred card, nothing competing with the
// form (2026-10-02, replaced the dark marketing panel). Two faint glows sit behind it
// (DESIGN.md 3.4; green and warm only, no blurple).
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full overflow-y-auto overflow-x-hidden bg-bg font-body text-fg">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute left-1/2 top-[18%] size-[420px] -translate-x-[78%] rounded-full bg-glow-green blur-[80px]" />
        <span className="absolute left-1/2 top-[34%] size-[380px] -translate-x-[12%] rounded-full bg-glow-warm blur-[80px]" />
      </div>

      <div className="relative flex min-h-full flex-col px-5 py-5 sm:px-8">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <span aria-hidden="true" className="text-fg">
              <Logo className="size-7" />
            </span>
            <span className="font-display text-[22px] font-medium tracking-[-0.03em]">Choir</span>
          </Link>
          <ThemeToggle />
        </header>

        <main id="main" className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          <div className="rounded-panel border border-line bg-card p-6 shadow-float sm:p-8">{children}</div>
        </main>

        <footer className="text-center text-[13px] text-fg-subtle">Your team and AI, on the same page.</footer>
      </div>
    </div>
  );
}
