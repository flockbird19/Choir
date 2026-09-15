import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  KeyRound,
  MessagesSquare,
  Pin,
  Radio,
  RefreshCcw,
  Search,
  Sparkles,
  SunMoon,
  Users,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { ProductMock } from "@/components/landing/ProductMock";
import { buttonClasses } from "@/components/ui/Button";
import { ThemeSwitch } from "@/components/ui/ThemeSwitch";

// Signed-in visitors never see this page: the proxy sends them from `/` to `/home`.
export const metadata: Metadata = {
  title: "Choir — Your team and AI, on the same page",
  description:
    "A team chat where your whole team and AI share the same context. Think privately, share deliberately, and keep every decision visible.",
};

const SIGN_UP = "/login?view=signup";

const PROBLEMS = [
  {
    icon: <MessagesSquare />,
    title: "Everyone has their own AI chat",
    body: "Each teammate gets somewhere useful alone, then copy-pastes transcripts to bring everyone else up to speed.",
  },
  {
    icon: <RefreshCcw />,
    title: "Context gets explained again and again",
    body: "Every new chat starts from zero, so the same background is re-typed for each person and each tool.",
  },
  {
    icon: <Pin />,
    title: "Decisions never become shared",
    body: "What the team agreed on sits in someone's private chat instead of where everyone can see it.",
  },
];

const FEATURES = [
  { icon: <Users />, title: "Shared and private AI threads", body: "One team conversation plus private threads, with context flowing one way: shared to private." },
  { icon: <ArrowUpRight />, title: "Post to Shared", body: "Publish the best of a private exploration to the team in a few clicks." },
  { icon: <Radio />, title: "Live team sync", body: "New messages appear for everyone instantly, with avatars showing who's viewing a thread." },
  { icon: <Pin />, title: "Global Decisions", body: "Pin any shared message as a Decision, collected in one panel the whole team can see." },
  { icon: <Sparkles />, title: "Catch me up", body: "An AI summary of the decisions, updates and open questions you missed since your last visit." },
  { icon: <KeyRound />, title: "Bring your own key", body: "Use your own Claude, OpenAI, Gemini or Groq API keys, stored encrypted." },
  { icon: <Download />, title: "Export", body: "Download any thread as Markdown or JSON to share outside the workspace." },
  { icon: <Search />, title: "Quick search", body: "Find threads and messages instantly with Cmd+K." },
  { icon: <SunMoon />, title: "Light and dark themes", body: "Easy on the eyes at 3 p.m. and at 3 a.m. before a deadline." },
];

const AUDIENCES = [
  "Hackathon teams",
  "Game jams",
  "Startup founding teams",
  "Dev agency sprints",
  "Open-source contributors",
  "Student project groups",
];

export default function LandingPage() {
  return (
    <div data-ds className="h-full overflow-y-auto bg-bg font-body text-fg motion-safe:scroll-smooth">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-primary px-3 py-2 text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur-md">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link href="/" className="mr-auto flex items-center gap-2 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <Logo className="size-7 text-primary" />
            <span className="font-display text-xl font-semibold tracking-[-0.01em]">Choir</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <a href="#how" className={buttonClasses({ variant: "ghost", size: "sm" })}>How it works</a>
            <a href="#features" className={buttonClasses({ variant: "ghost", size: "sm" })}>Features</a>
            <a href="#who" className={buttonClasses({ variant: "ghost", size: "sm" })}>Who it&rsquo;s for</a>
          </div>
          <ThemeSwitch size="sm" />
          <Link href="/login" className={buttonClasses({ variant: "ghost", size: "sm", className: "hidden sm:inline-flex" })}>
            Sign in
          </Link>
          <Link href={SIGN_UP} className={buttonClasses({ variant: "primary", size: "sm" })}>
            Get started
          </Link>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[640px]"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in srgb, var(--ds-primary) 16%, transparent), transparent 70%), radial-gradient(color-mix(in srgb, var(--ds-fg) 7%, transparent) 1px, transparent 1px)",
              backgroundSize: "auto, 24px 24px",
              maskImage: "linear-gradient(to bottom, black 40%, transparent)",
            }}
          />
          <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pb-16 pt-14 text-center sm:px-6 sm:pt-20 lg:pb-24">
            <p className="inline-flex animate-rise items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-label font-medium text-fg-muted shadow-soft motion-reduce:animate-none">
              <span className="size-1.5 rounded-full bg-team" aria-hidden="true" />
              Multiplayer AI for small, fast-moving teams
            </p>
            <h1
              className="mt-6 max-w-3xl animate-rise text-balance font-display text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] text-fg motion-reduce:animate-none sm:text-display-lg"
              style={{ animationDelay: "80ms" }}
            >
              Your team and AI, on the same page.
            </h1>
            <p
              className="mt-5 max-w-2xl animate-rise text-pretty text-body-lg text-fg-muted motion-reduce:animate-none sm:text-title sm:leading-relaxed"
              style={{ animationDelay: "160ms" }}
            >
              Choir is a team chat where everyone and the AI share one context. Think privately, share deliberately,
              and keep every decision where the whole team can see it.
            </p>
            <div
              className="mt-8 flex w-full animate-rise flex-col items-stretch justify-center gap-3 motion-reduce:animate-none sm:w-auto sm:flex-row"
              style={{ animationDelay: "240ms" }}
            >
              <Link href={SIGN_UP} className={buttonClasses({ variant: "primary", size: "lg" })}>
                Create a workspace <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link href="/login" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                Sign in
              </Link>
            </div>

            <div className="relative mt-14 w-full max-w-4xl sm:mt-16">
              <p className="sr-only">
                Illustration: a shared thread where a teammate asks a question, the AI answers, another teammate shares
                a note from a private thread, and the answer is pinned as a decision.
              </p>
              <div aria-hidden="true">
                <ProductMock />
              </div>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section aria-labelledby="problem-title" className="border-y border-line bg-card">
          <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 lg:py-24">
            <div className="flex max-w-2xl flex-col gap-3">
              <p className="text-label font-semibold uppercase tracking-[0.12em] text-primary">The problem</p>
              <h2 id="problem-title" className="text-balance font-display text-display-sm font-semibold">
                AI is single-player. Teams aren&rsquo;t.
              </h2>
            </div>
            <ul className="grid gap-4 md:grid-cols-3">
              {PROBLEMS.map((problem) => (
                <li key={problem.title} className="flex flex-col gap-3 rounded-card border border-line bg-bg p-5">
                  <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-control bg-card text-fg-muted shadow-soft [&_svg]:size-5">
                    {problem.icon}
                  </span>
                  <h3 className="font-display text-title font-semibold">{problem.title}</h3>
                  <p className="text-body text-fg-muted">{problem.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-16">
          <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 lg:py-24">
            <div className="flex max-w-2xl flex-col gap-3">
              <p className="text-label font-semibold uppercase tracking-[0.12em] text-primary">How it works</p>
              <h2 id="how-title" className="text-balance font-display text-display-sm font-semibold">
                Think privately. Decide together.
              </h2>
              <p className="text-body-lg text-fg-muted">
                Every project has two kinds of conversations, and context flows one way: shared to private.
              </p>
            </div>
            <HowItWorks />
          </div>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className="scroll-mt-16 border-y border-line bg-card">
          <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 lg:py-24">
            <div className="flex max-w-2xl flex-col gap-3">
              <p className="text-label font-semibold uppercase tracking-[0.12em] text-primary">Features</p>
              <h2 id="features-title" className="text-balance font-display text-display-sm font-semibold">
                Everything a team needs to work from the same context
              </h2>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-sheet border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex flex-col gap-2 bg-card p-6">
                  <span aria-hidden="true" className="mb-1 flex size-9 items-center justify-center rounded-control bg-primary-soft text-primary [&_svg]:size-[18px]">
                    {feature.icon}
                  </span>
                  <h3 className="font-display text-body-lg font-semibold">{feature.title}</h3>
                  <p className="text-body-sm text-fg-muted">{feature.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Who it's for */}
        <section id="who" aria-labelledby="who-title" className="scroll-mt-16">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:py-24">
            <div className="flex flex-col gap-3">
              <p className="text-label font-semibold uppercase tracking-[0.12em] text-primary">Who it&rsquo;s for</p>
              <h2 id="who-title" className="text-balance font-display text-display-sm font-semibold">
                Teams that come together quickly and move fast
              </h2>
              <p className="text-body-lg text-fg-muted">
                Small technical teams who need everyone working from the same context, from the first message.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2.5">
              {AUDIENCES.map((audience) => (
                <li key={audience} className="rounded-full border border-line bg-card px-4 py-2 text-body font-medium text-fg shadow-soft">
                  {audience}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final call to action */}
        <section aria-labelledby="cta-title" className="px-4 pb-16 sm:px-6 lg:pb-24">
          <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-sheet bg-panel px-6 py-14 text-center text-white sm:py-20">
            <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 text-white/[0.06]">
              <Logo className="size-[420px]" />
            </span>
            <h2 id="cta-title" className="relative max-w-2xl text-balance font-display text-display-sm font-semibold sm:text-display">
              Bring your team and your AI into one conversation
            </h2>
            <p className="relative max-w-xl text-body-lg text-white/70">
              Create a workspace, invite your teammates with a link, and ask the AI in the shared thread.
            </p>
            <div className="relative flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                href={SIGN_UP}
                className={buttonClasses({ variant: "inverse", size: "lg" })}
              >
                Create a workspace <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className={buttonClasses({ variant: "inverseGhost", size: "lg" })}
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-body-sm text-fg-muted sm:flex-row sm:items-center sm:px-6">
          <span className="flex items-center gap-2 text-fg">
            <Logo className="size-5 text-primary" />
            <span className="font-display font-semibold">Choir</span>
          </span>
          <span className="sm:mr-auto">Choir is in active development.</span>
          <span>Built with Next.js, FastAPI and Supabase.</span>
        </div>
      </footer>
    </div>
  );
}
