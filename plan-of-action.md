# Choir - Plan of Action

This document outlines the step-by-step implementation plan for building Choir from scratch, based on the architecture defined in `choir-context.md`.

## Phase 1: Foundation (Database & Auth)
*Goal: Get the data layer and user authentication working.*

1. **Supabase Setup:** Create a new Supabase project.
2. **Database Schema:** Execute the SQL script from `choir-context.md` to create tables (`teams`, `team_members`, `projects`, `threads`, `messages`, `user_api_keys`).
3. **Row-Level Security (RLS):** Apply the RLS policies defined in the architecture doc to protect Postgres from unauthorized frontend access.
4. **Next.js Initialization:** Clean up the existing `/frontend` Next.js template.
5. **Supabase Auth:** Implement Supabase Auth (Email/Password or OAuth) in Next.js and ensure users can log in and out.

## Phase 2: Core UI & Local State
*Goal: Build the static chat interface.*

1. **Layouts:** Build the 1-Pane view (Slack-like) with the Sidebar (navigation) and the Main Thread View.
2. **Context Drawer:** Build the sliding right-drawer for viewing the Shared Thread while inside a Private Thread.
3. **Data Fetching:** Connect Next.js to Supabase to fetch and display the user's teams, projects, and threads.
4. **Chat Interface:** Build the message list and chat input box. Render mock messages first, then connect to the `messages` table.

## Phase 3: Backend Security & Infrastructure
*Goal: Set up the Python API safely.*

1. **FastAPI Setup:** Clean up the `/backend` directory, set up `uv`, FastAPI, and required dependencies.
2. **Environment Variables:** Securely store the Supabase Service Role Key, JWT Secret, and the custom Master Encryption Key.
3. **Authentication Middleware:** Implement FastAPI middleware to intercept the `Authorization` header from Next.js and verify the Supabase JWT.
4. **Authorization Logic:** Write helper functions in FastAPI to manually check if a `user_id` has access to a specific `thread_id` or `team_id` (since RLS is bypassed by the service role).

## Phase 4: LLM Engine & Streaming
*Goal: Make the AI talk.*

1. **Key Management:** Implement BYOK. Create endpoints to encrypt user API keys and store them in Postgres, and helper functions to decrypt them at runtime.
2. **Context Assembly:** Write the logic to fetch a Private Thread's history and inject the Shared Thread's history into the LLM system prompt.
3. **LLM Orchestration:** Integrate with the Anthropic/OpenAI SDKs to handle the chat completions.
4. **PubSub Streaming:** Implement the logic to stream LLM text chunks directly to Supabase Realtime Broadcast.

## Phase 5: Closing the Loop (Frontend AI Integration)
*Goal: Connect the UI to the AI.*

1. **The `@AI` Trigger:** Modify the Next.js chat input to detect `@AI`. When detected, send a POST request to FastAPI with the user's JWT.
2. **Realtime Listener:** Implement a Supabase Realtime subscriber in Next.js that listens for incoming chunks from FastAPI and appends them to a temporary "typing" message bubble.
3. **Finalize Write:** Ensure that when the stream completes, the final message is properly re-fetched from Postgres.

## Phase 6: Polish & Unique Features
*Goal: Implement Choir's unique collaborative features.*

1. **"Post to Shared":** Build the UI to select multiple private messages and the logic to insert them into the shared thread as a unified Markdown block.
2. **"Transfer Context" (Export):** Build the FastAPI endpoint to fetch a thread, scrub sensitive metadata, and return a `.md` or `.json` file. Add the export button to the Next.js UI.
3. **Graceful Failures:** Implement UI handling for 429 errors (budget limits) and streaming disconnections.
