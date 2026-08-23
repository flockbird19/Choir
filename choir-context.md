# Choir — Architecture & Product Context (v1)

## What is Choir?

Choir is a team chat app where a group of people and an AI model share context. It solves the "single-player AI" problem: instead of everyone having private 1:1 chats with an AI and manually copy-pasting transcripts to loop each other in, Choir makes AI collaboration live and shared, like Google Docs did for documents.

## Core Concept: Shared thread + Private threads

- A **Project** belongs to a **Team** and has one **Shared Thread** — the canonical, always-visible conversation everyone on the team sees.
- Each team member also has **multiple named Private Threads** within that project — personal scratch spaces to explore different ideas with the AI without cluttering the shared thread.
- **Context flows one direction only:** shared thread → private thread. Your private thread's AI calls always include the full shared thread history + your own private history. The shared thread never sees your private thread unless you explicitly share a message into it.
- **"Post to shared"** is the core new interaction: from your private thread, you can push a block of messages into the shared thread. It appears formatted as a clearly marked shared thought.
- **"Transfer Context" (Export):** Users can export a thread's history (shared or private) as a Markdown or JSON file to easily share complex AI sessions with people outside the workspace.

## Tech Stack (Dual-Stack)
*(Note: A split stack increases deployment complexity for v1 (e.g., Next.js on Vercel + FastAPI on Railway/Render), but is an intentional tradeoff to leverage Python's LLM ecosystem for orchestration and chunk streaming.)*

- **Frontend (`/frontend`):** Next.js (TypeScript, Tailwind, React). Handles purely the UI, local state, and Supabase Auth.
- **Backend (`/backend`):** Python (FastAPI). Handles BYOK key decryption, prompt assembly, calling LLMs, and streaming.
- **Database/Realtime:** Supabase (Postgres + Supabase Realtime + Supabase Auth). 
- **Real-time Streaming:** FastAPI streams AI typing chunks directly to Supabase Realtime Broadcast (PubSub). The frontend listens to PubSub, preventing Postgres from being hammered with token-by-token DB writes.

## Model Access: BYOK & Cost Controls

Users supply their own provider API keys (Anthropic, OpenAI, etc.). Keys are encrypted before writing to Postgres (using Supabase Vault or app-layer encryption). **Crucially, the master encryption/decryption key must live solely as an environment variable on the FastAPI server** (never in the repo or Supabase).

- **Private threads (Pure BYOK):** Users pick their own model and use their own stored API key. They bear their own usage cost.
- **Shared thread (Owner Pays):** Uses one consistent model per project (e.g., Claude 3.5), powered by the **Project Owner's** API key.
- **Wallet Spam Protection:** The Project Owner sets hard budget limits directly in their provider's dashboard (e.g., $10/month cap). The backend gracefully catches `429 Too Many Requests` errors.

## Data Model (Postgres)

```sql
-- Teams & Members
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table team_members (
  team_id uuid references teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'member', -- 'owner' | 'member'
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- Projects
create table projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id),
  shared_model_provider text default 'anthropic',
  shared_model_name text default 'claude-sonnet-5',
  shared_model_key_id uuid, -- references user_api_keys(id)
  created_at timestamptz default now()
);

-- Threads (Shared + Multiple Private per user)
create table threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  type text not null check (type in ('shared', 'private')),
  owner_id uuid references auth.users(id), -- null for shared, set for private
  name text, -- e.g., "Exploring auth flow"
  model_provider text,
  model_name text,
  created_at timestamptz default now()
);

-- Messages
create table messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'assistant')),
  sender_id uuid references auth.users(id),
  content text not null,
  model_provider text,
  model_name text,
  created_at timestamptz default now(),
  shared_by uuid references auth.users(id) -- null for native messages; only set for blocks posted from private
);

-- API Keys
create table user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  encrypted_key text not null, 
  created_at timestamptz default now(),
  unique (user_id, provider)
);
```

### Row-Level Security (RLS)
- `threads`: Users can only see rows where `type = 'shared'` (if in the team) OR `owner_id = auth.uid()`. Prevents seeing names of others' private threads.
- `messages`: Users can read messages in a `private` thread only if the parent thread's `owner_id = auth.uid()`.
- `user_api_keys`: Users can only read/write their own row.

## FastAPI Authorization & RLS Bypass (CRITICAL)

Because FastAPI needs to decrypt API keys and insert messages on users' behalf, it uses the **Supabase Service Role Key**. This key **bypasses Postgres Row-Level Security (RLS) entirely**. Therefore, FastAPI must manually re-implement authorization before taking any action:
1. **Authentication:** Next.js sends the user's Supabase JWT in the `Authorization` header to FastAPI. FastAPI verifies this JWT using the Supabase JWT secret.
2. **Authorization:** FastAPI must query the DB to ensure the `user_id` from the JWT actually has access to the requested resource (e.g., are they a member of the team? do they own the private thread?). 

## Message Flow & AI Logic

### 1. Triggering AI in the Shared Thread
- Users send a normal chat message. If it contains **`@AI`** as a distinct word token (e.g., "@AI can you review this?"), the Next.js frontend calls the FastAPI backend.
- FastAPI assembles the full shared thread history. Any imported private messages are wrapped in a Markdown block labeled `[Shared from User's private thread]`.
- FastAPI calls the LLM using the Owner's decrypted key.
- FastAPI **streams chunks via Supabase PubSub**. The frontend listens to this channel (scoped by `response_id` to prevent concurrent collisions).
- Once the stream finishes, FastAPI inserts the final response into the `messages` Postgres table.

### 2. Triggering AI in a Private Thread
- FastAPI assembles context: The **Shared Thread history** is injected into the LLM's **System Prompt** as a static context document. The **Private Thread history** is passed as the actual conversational message array. (This ensures the LLM knows its current role).

### 3. "Post to shared" (Private -> Shared)
- The user selects multiple messages in their private thread and clicks "share".
- Next.js groups them into a **single Markdown block**.
- Inserts that block as a **single new message row** in the shared thread, with `shared_by` set.

### 4. "Transfer Context" (Exporting Threads)
- A user clicks "Transfer Context" on a thread (shared or private).
- Next.js calls a FastAPI endpoint to fetch the thread's messages.
- FastAPI formats the history (scrubbing sensitive metadata like API keys) into a downloadable Markdown (`.md`) or JSON file.
- Markdown allows easy reading by humans via email/Slack, while JSON paves the way for future "Import Context" functionality across different Choir instances.

## UI Layout (1-Pane View)
- The desktop UI mimics Slack/Discord. You view one full-screen thread at a time.
- **Sidebar:** Navigation list of the Shared Thread and your named Private Threads.
- **Context Drawer:** When inside a Private Thread, you can toggle a sliding side-drawer to view the Shared Thread simultaneously.

## Known Gaps / V1 Tradeoffs
1. **Streaming Failure Mode:** If the connection drops mid-stream, the final message isn't written to Postgres and is lost. UI must fail gracefully.
2. **Explicit 429 Errors:** When the Owner's dashboard limit is hit, FastAPI must catch it and send a PubSub event so the UI displays: *"Shared AI is unavailable — ask the project owner to check their usage limits."*
3. **Concurrent `@AI` Mentions:** Parallel mentions execute parallel LLM calls. PubSub streams must be scoped by a unique `response_id` so they render in distinct UI bubbles.
4. **Context Bloat:** Injecting the full shared history into private threads will eventually max out tokens. V1 accepts this; V2 needs summarization.
