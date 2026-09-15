import { login, signup, loginWithGoogle } from './actions';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PasswordInput } from '@/components/PasswordInput';

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
      <main className="flex-1 flex flex-col items-center justify-center px-6 z-10 pb-16">
        <div className="w-full max-w-sm">

          {/* Heading */}
          <div className="mb-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-5">
              <Logo className="w-6 h-6 text-accent" />
            </div>
            <h1 className="font-serif text-4xl text-ink mb-2 tracking-tight">Welcome</h1>
            <p className="text-graphite text-sm">Sign in or create an account to continue.</p>
          </div>

          {/* Google OAuth button */}
          <form>
            <button
              formAction={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-surface border border-border text-ink rounded-xl px-4 py-3 text-sm font-medium hover:bg-surface-hover active:scale-[0.99] transition-all shadow-sm"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-canvas text-xs text-graphite/60">or continue with email</span>
            </div>
          </div>

          {/* Email/Password Form */}
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
              <PasswordInput />
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
              <div role="alert" className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-center rounded-xl text-sm">
                {resolvedParams.message}
              </div>
            )}
          </form>

          <p className="mt-8 text-center text-xs text-graphite/50">
            Choir · Multiplayer AI for teams
          </p>
        </div>
      </main>
    </div>
  );
}
