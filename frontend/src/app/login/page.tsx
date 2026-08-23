import { login, signup } from './actions';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const resolvedParams = await searchParams;

  return (
    <div className="min-h-screen w-full bg-canvas flex flex-col relative overflow-hidden">

      {/* Ambient background blobs */}
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-accent/6 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-15%] left-[-5%] w-[40%] h-[40%] bg-graphite/4 rounded-full blur-[120px] pointer-events-none" />

      {/* Top bar */}
      <div className="w-full px-8 py-5 flex justify-between items-center z-10">
        <div className="flex items-center gap-2.5">
          <Logo className="w-6 h-6 text-ink" />
          <span className="font-serif text-xl tracking-wide text-ink">Choir</span>
        </div>
        <ThemeToggle />
      </div>

      {/* Centered form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 z-10 pb-16">
        <div className="w-full max-w-sm">

          {/* Heading */}
          <div className="mb-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-5">
              <Logo className="w-6 h-6 text-accent" />
            </div>
            <h1 className="font-serif text-4xl text-ink mb-2 tracking-tight">Welcome</h1>
            <p className="text-graphite text-sm">Sign in or create an account to continue.</p>
          </div>

          {/* Form */}
          <form className="flex flex-col gap-4">

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full rounded-xl px-4 py-3 bg-surface border border-border text-ink
                  placeholder:text-graphite/50 text-sm transition-all
                  focus:border-accent focus:ring-2 focus:ring-accent/12 focus:outline-none"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="w-full rounded-xl px-4 py-3 bg-surface border border-border text-ink
                  placeholder:text-graphite/50 text-sm transition-all
                  focus:border-accent focus:ring-2 focus:ring-accent/12 focus:outline-none"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                formAction={login}
                className="w-full bg-accent text-white rounded-xl px-4 py-3 text-sm font-semibold
                  hover:bg-accent/90 active:scale-[0.99] transition-all flex justify-center items-center
                  shadow-sm shadow-accent/25"
              >
                Sign in
              </button>
              <button
                formAction={signup}
                className="w-full bg-surface border border-border text-ink rounded-xl px-4 py-3 text-sm font-medium
                  hover:bg-surface-hover transition-colors flex justify-center items-center"
              >
                Create account
              </button>
            </div>

            {/* Error message */}
            {resolvedParams?.message && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-center rounded-xl text-sm">
                {resolvedParams.message}
              </div>
            )}
          </form>

          <p className="mt-8 text-center text-xs text-graphite/50">
            Choir · Multiplayer AI for teams
          </p>
        </div>
      </div>
    </div>
  );
}
