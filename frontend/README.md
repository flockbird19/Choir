# Choir frontend

Next.js 16 (App Router, React 19, Tailwind v4) app for Choir — a team chat where a small team and an AI
share context. See the repo root for the full project write-up and design rules.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll need `.env.local` with the Supabase project's
URL and keys, and the backend (`../backend`) running for `@AI` replies, digests and exports.

Next.js 16 has real breaking changes from older versions — read `AGENTS.md` in this folder before writing
code here.

## Checks

```bash
npm run lint        # eslint, 0 errors expected
npx tsc --noEmit     # type check
npx next build --webpack   # production build
```

If `tsc` or the build fail oddly after a change, delete `.next/dev/types` and retry.

## Layout

- `src/app/` — routes. `(main)/` is the signed-in app (home, thread, profile, settings); `login/`,
  `onboarding/`, `invite/[token]/`, `auth/` are signed-out flows; `preview/` is the in-progress redesigned
  thread view.
- `src/components/chat/` — the live thread view. `src/components/thread-v2/` — its in-progress replacement.
- `src/components/ui/` — design-system primitives.
- `src/utils/supabase/` — Supabase clients and shared queries (`server.ts`, `admin.ts`, `queries.ts`,
  `member-names.ts`).
- `src/hooks/` — realtime messages, presence, member names, notifications.

## In a worktree (parallel build lanes)

Turbopack refuses a junctioned `node_modules`, so worktrees run the dev server with webpack:

```bash
npx next dev --webpack -p 3103
```

Junction `node_modules` from the main checkout and copy `.env.local` in first. Never use ports 3000/8000 —
those are the main checkout's.
