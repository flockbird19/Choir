import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandPanel } from "./BrandPanel";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-bg font-body text-fg">
      <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex min-h-dvh flex-col px-5 py-5 sm:px-10 lg:min-h-full">
          <header className="flex items-center justify-between">
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <span aria-hidden="true" className="text-primary">
                <Logo className="size-7" />
              </span>
              <span className="font-display text-xl font-semibold tracking-[-0.01em]">Choir</span>
            </Link>
            <ThemeToggle />
          </header>

          <main id="main" className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
            {children}
          </main>

          <footer className="text-[13px] text-fg-subtle">Your team and AI, on the same page.</footer>
        </div>

        <BrandPanel />
      </div>
    </div>
  );
}
