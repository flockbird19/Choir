"use client";

import { useState, useTransition } from "react";
import { createTeamSetup } from "./actions";
import { Logo } from "@/components/Logo";

export default function OnboardingPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createTeamSetup(formData);
      if (res?.error) {
        setError(res.error);
      }
    });
  };

  return (
    <div className="min-h-screen w-full bg-canvas flex flex-col relative overflow-hidden">

      {/* Ambient blobs — matches login page */}
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-accent/6 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-15%] left-[-5%] w-[40%] h-[40%] bg-graphite/4 rounded-full blur-[120px] pointer-events-none" />

      {/* Top bar */}
      <div className="w-full px-8 py-5 flex justify-between items-center z-10">
        <div className="flex items-center gap-2.5">
          <Logo className="w-6 h-6 text-ink" />
          <span className="font-serif text-xl tracking-wide text-ink">Choir</span>
        </div>
      </div>

      {/* Centered form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 z-10 pb-16">
        <div className="w-full max-w-sm">

          {/* Heading */}
          <div className="mb-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-5">
              <Logo className="w-6 h-6 text-accent" />
            </div>
            <h1 className="font-serif text-4xl text-ink mb-2 tracking-tight">Welcome to Choir</h1>
            <p className="text-graphite text-sm">
              Let&apos;s set up your first team workspace.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="teamName" className="block text-sm font-medium text-ink mb-1.5">
                Team Name
              </label>
              <input
                type="text"
                id="teamName"
                name="teamName"
                required
                autoFocus
                placeholder="e.g. Acme Corp, Design Team…"
                className="w-full rounded-xl px-4 py-3 bg-surface border border-border text-ink
                  placeholder:text-graphite/50 text-sm transition-all
                  focus:border-accent focus:ring-2 focus:ring-accent/12 focus:outline-none"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="w-full mt-1 bg-accent text-white rounded-xl px-4 py-3 text-sm font-semibold
                hover:bg-accent/90 active:scale-[0.99] transition-all flex justify-center items-center
                shadow-sm shadow-accent/25 disabled:opacity-60"
            >
              {isPending ? "Creating your workspace…" : "Create Workspace"}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-graphite/50">
            Choir · Multiplayer AI for teams
          </p>
        </div>
      </div>
    </div>
  );
}
