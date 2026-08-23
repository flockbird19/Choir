# Choir

Choir is a collaborative, real-time AI platform that bridges the gap between individual AI experimentation and team-wide intelligence sharing. It features a Slack-like interface where users can have private conversations with LLMs (Claude, GPT-4) and seamlessly promote valuable insights to a shared team space.

## Architecture

Choir is built with a modern, separated stack:

- **Frontend (`/frontend`)**: Next.js 15 (App Router), React, Tailwind CSS. Provides a highly responsive, single-pane and sliding-drawer UI.
- **Backend (`/backend`)**: Python FastAPI. Handles LLM orchestration, streaming text generation, and secure operations.
- **Database & Auth**: Supabase (PostgreSQL). Powers user authentication, Row-Level Security (RLS), and Realtime pub/sub for chat streaming.

## Core Features

- **Private & Shared Contexts**: Explore ideas in private threads, then selectively post the best results to a unified team thread.
- **Bring Your Own Key (BYOK)**: Secure, encrypted storage of user-provided Anthropic/OpenAI API keys in the database.
- **Realtime Streaming**: AI responses are streamed directly from the Python backend to the database and broadcasted to the frontend via Supabase Realtime.
- **Team Isolation**: Projects and threads are securely isolated by organization/team boundaries.

## Getting Started

### 1. Database Setup
Execute the SQL statements from `schema.sql` in your Supabase SQL Editor to create the necessary tables and policies.

### 2. Backend (FastAPI)
Navigate to the `/backend` directory.
Create a `.env` file based on `.env.example`.
Run the server using `uv`:
```bash
cd backend
uv run uvicorn main:app --reload
```

### 3. Frontend (Next.js)
Navigate to the `/frontend` directory.
Create a `.env.local` file with your Supabase keys.
Run the development server:
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.
