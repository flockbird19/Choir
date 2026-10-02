-- ============================================================================
-- Choir database schema — one script, safe to re-run
-- Creates what's missing, keeps all data, keeps RLS ON, resets all access rules.
--
-- This file is the source of truth for the live database. To change the
-- database: edit this file, paste the whole script into the Supabase SQL Editor
-- ("Choir schema" snippet) and run it. Last applied to live: 2026-09-17 (Batch 1 +
-- permission fixes). Applied 2026-09-18 (Batch 2): profiles with status (E4),
-- thread_reads.last_read_at (E5), messages.source_message_ids (K3).
-- Pending re-run (Batch 2b): foreign-key indexes, thread_summaries (D3).
-- Applied 2026-09-23: L16 rename permission on threads.name (the "Team members
-- can rename shared threads" policy, and threads' update grant including name).
-- Pending re-run (2026-09-23, E2 phase 4): profiles.seen_onboarding_tour, so the
-- Team Space coach-mark tour persists "seen it" per account instead of per page load.
-- Pending re-run (2026-09-26, M1/M2 spike, on branch spike-agents): profiles.kind/
-- owner_id and the new agent_connections table, for connecting a coding agent to a
-- project via MCP. Additive only (new columns with a default, new table) — safe to
-- run against live even though the spike itself is unproven; nothing existing changes.
-- Pending re-run (2026-09-28, L23): trigger blocking ai_auto_reply changes on Team Space.
-- Pending re-run (2026-09-29, curation): messages.withdrawn_at + publish_edited, the
-- withdraw_publication() function, and "no pinning a withdrawn post".
-- Pending re-run (2026-09-29, context & memory): messages.kind/covers_through/covers_count
-- (compact checkpoints), the project_memory table + is_project_member(), withdraw also undoing
-- checkpoints and memory items, checkpoints never pinnable.
-- Pending re-run (2026-09-30, AI activity): messages.sources (web pages an AI reply used).
-- Pending re-run (2026-09-30, file uploads, branch file-uploads): messages.attachments, the
-- attachment helpers, the private "attachments" storage bucket and its rules (§7), withdraw
-- also clearing a post's attachments.
-- Pending re-run (2026-10-01, team page, branch team-page): teams.description and icon columns,
-- members seeing their teammates' memberships, owners (not only the creator) deleting a team,
-- leave_team / remove_member / make_owner, private threads needing team membership too, and
-- the public "team-icons" storage bucket (§7).
-- Pending re-run (2026-10-02, tasks stage 1, branch tasks): the tasks table and its functions,
-- messages.kind 'task_done' + messages.task_id (the "finished" line), leaving releases your tasks.
-- Pending re-run (2026-10-02, agents stage 2, branch stage2-agents): agents' OAuth tokens refused
-- everywhere (is_first_party, a "Choir app only" rule per table and on storage, a pre-request check).
-- APPLIED 2026-10-02 (live RLS 57/57). Pending re-run (same branch, part 2): agent_grants +
-- connect_agent, tasks.via_client/thread_id/review_message_id, messages sender_type 'agent',
-- via_client, kind 'task_review' + review/review_state, send_back_task, complete/release/leave updates.
-- ============================================================================

begin;

-- ── 0. Locks ─────────────────────────────────────────────────────────────────
-- Take every table lock up front, messages first (the order the live app reads
-- them), so the script can't deadlock with app traffic halfway through. Give up
-- after 15 seconds instead of waiting forever; if that happens, just run it again.
set local lock_timeout = '15s';
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'threads', 'projects', 'team_members', 'teams',
                           'team_invitations', 'user_api_keys', 'thread_reads', 'ai_request_log',
                           'notifications', 'shared_keys', 'profiles', 'thread_summaries', 'agent_connections',
                           'project_memory', 'tasks', 'agent_grants']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
    end if;
  end loop;
end $$;

-- ── 1. Tables ────────────────────────────────────────────────────────────────

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.team_members (
  team_id uuid references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'member',
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id),
  shared_model_provider text default 'anthropic',
  shared_model_name text default 'claude-haiku-4-5',
  shared_model_key_id uuid,
  created_at timestamptz default now()
);

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  type text not null check (type in ('shared', 'private')),
  owner_id uuid references auth.users(id),
  name text,
  model_provider text,
  model_name text,
  created_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.threads(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'assistant')),
  sender_id uuid references auth.users(id),
  content text not null,
  model_provider text,
  model_name text,
  created_at timestamptz default now()
);

-- Columns added after the first version (no-ops if they already exist)
alter table public.messages add column if not exists shared_by uuid references auth.users(id);
alter table public.messages add column if not exists is_decision boolean not null default false;
alter table public.messages add column if not exists pinned_by uuid references auth.users(id);
alter table public.messages add column if not exists pinned_at timestamptz;
-- Private threads: the AI replies to every message unless the owner mutes it
alter table public.threads add column if not exists ai_auto_reply boolean not null default true;

create table if not exists public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  encrypted_key text not null,
  created_at timestamptz default now(),
  unique (user_id, provider)
);

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete cascade,
  token uuid default gen_random_uuid() unique,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Catch Me Up: each user's last digest position per thread
create table if not exists public.thread_reads (
  thread_id uuid references public.threads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- E4: one row per person: the name teammates and the AI see, plus a status.
-- Replaces looking names up through the auth admin API (also fixes L14, the 5-minute delay).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  status text,
  updated_at timestamptz not null default now()
);

-- E2 onboarding rebuild: has this account clicked through the Team Space coach-mark
-- tour? Server-side so it follows the account across devices, not per-browser.
alter table public.profiles add column if not exists seen_onboarding_tour boolean not null default false;

-- Fill it for everyone who already has an account, and keep it filled for new sign-ups.
insert into public.profiles (id, display_name)
select u.id, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- M2 spike: an "agent" is a real (synthetic, non-login) auth.users account owned by
-- the person who connected it, so it's already a normal team_members/messages.sender_id
-- everywhere else — no RLS or FK changes needed for it to post or be seen.
alter table public.profiles add column if not exists kind text not null default 'human' check (kind in ('human', 'agent'));
alter table public.profiles add column if not exists owner_id uuid references auth.users(id);

-- M1 spike: one row per connected coding tool. The token is hashed (never stored raw) —
-- the backend hashes an incoming token and looks it up, it never needs to recover it.
create table if not exists public.agent_connections (
  id uuid primary key default gen_random_uuid(),
  agent_user_id uuid references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  kind text,
  token_hash text not null unique,
  created_at timestamptz default now(),
  last_seen_at timestamptz
);

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists create_profile_on_signup on auth.users;
create trigger create_profile_on_signup
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- E5: "Seen by". Kept separate from last_seen_at, which is the Catch me up position.
alter table public.thread_reads add column if not exists last_read_at timestamptz;

-- K3: a Decision remembers which private messages it came from (the trail).
alter table public.messages add column if not exists source_message_ids uuid[];

-- AI rate limiter log (backend only)
create table if not exists public.ai_request_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index if not exists ai_request_log_user_time_idx
  on public.ai_request_log (user_id, requested_at);

-- D2: a private thread started from a Team Space message ("Discuss privately")
alter table public.threads add column if not exists forked_from_message_id uuid
  references public.messages(id) on delete set null;

-- K2: a Team Space post published from a private thread ("Publish findings")
alter table public.messages add column if not exists source_thread_id uuid
  references public.threads(id) on delete set null;

-- WhatsApp-style "reply to" a specific earlier message (same thread only).
alter table public.messages add column if not exists reply_to_message_id uuid
  references public.messages(id) on delete set null;

-- Curation: the publisher edited selected messages before posting them, so the post
-- isn't shown as an unchanged quote. And a publication can be withdrawn: the row stays
-- (replies to it keep working) but its text is cleared. See withdraw_publication().
alter table public.messages add column if not exists publish_edited boolean not null default false;
alter table public.messages add column if not exists withdrawn_at timestamptz;

-- Component #4, context: a compact checkpoint is a visible card in the thread (kind =
-- 'checkpoint', written only by the backend). Its content summarises every message up to
-- covers_through; the AI then reads the card plus the messages after it. Undo = withdrawn_at.
alter table public.messages add column if not exists kind text not null default 'message'
  check (kind in ('message', 'checkpoint'));
alter table public.messages add column if not exists covers_through timestamptz;
alter table public.messages add column if not exists covers_count integer;

-- Web pages an AI reply searched ([{url, title}]), shown as its Sources. Written only by the
-- backend: it is not in the insert or update grants below, so people can't set it.
alter table public.messages add column if not exists sources jsonb;

-- Files attached to a message: [{path, name, size, type}]. `path` is the file's place in the
-- private "attachments" storage bucket, "<thread id>/<random id>/<file name>"; the insert
-- rule below only accepts paths inside the message's own thread folder.
alter table public.messages add column if not exists attachments jsonb;

-- Team page (2026-10-01): a short description, and the team's icon in the rail: initials, a
-- Lucide icon (by name) or an uploaded image (a path in the "team-icons" bucket, inside the
-- team's own folder), on one of a fixed set of colours (DESIGN.md 3.7).
alter table public.teams add column if not exists description text;
alter table public.teams add column if not exists icon_kind text not null default 'initials';
alter table public.teams add column if not exists icon_name text;
alter table public.teams add column if not exists icon_color text not null default 'default';
alter table public.teams add column if not exists icon_path text;
alter table public.teams drop constraint if exists teams_description_check;
alter table public.teams add constraint teams_description_check
  check (description is null or char_length(description) <= 280);
alter table public.teams drop constraint if exists teams_icon_check;
alter table public.teams add constraint teams_icon_check check (
  icon_kind in ('initials', 'icon', 'image')
  and icon_color in ('default', 'slate', 'teal', 'olive', 'rust', 'rose', 'cocoa')
  and (icon_name is null or icon_name ~ '^[a-z0-9-]{1,40}$')
  and (icon_kind <> 'icon' or icon_name is not null)
  and (icon_kind <> 'image' or icon_path is not null)
  and (icon_path is null or (
    split_part(icon_path, '/', 1) = id::text
    and icon_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp)$'
  ))
);

-- L5: invite links expire after 7 days and can be revoked.
-- (Existing links get 7 days from the first run of this line.)
alter table public.team_invitations add column if not exists expires_at timestamptz not null
  default (now() + interval '7 days');
alter table public.team_invitations add column if not exists revoked_at timestamptz;

-- F3: in-app notifications (e.g. "your key hit its rate limit"). Written by the backend.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_time_idx
  on public.notifications (user_id, created_at desc);

-- F4 + F5: teammates lend a saved key to a project.
--   mode 'fallback' = used only when the owner's key is rate-limited (F4)
--   mode 'pool'     = shared-thread requests rotate across pooled keys (F5)
-- Deleting the saved key removes the lending row.
create table if not exists public.shared_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_id uuid not null references public.user_api_keys(id) on delete cascade,
  provider text not null,
  mode text not null check (mode in ('fallback', 'pool')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, user_id, provider)
);

-- Shared threads default to Claude Haiku 4.5 (cheapest; decided 2026-09-15).
alter table public.projects alter column shared_model_name set default 'claude-haiku-4-5';
-- One-time switch of existing Anthropic projects to Haiku (2026-09-15). Remove this line once
-- projects can choose their own shared model, or re-running the script will reset that choice.
update public.projects
  set shared_model_name = 'claude-haiku-4-5'
  where shared_model_provider = 'anthropic' and shared_model_name is distinct from 'claude-haiku-4-5';

-- D3: a rolling summary of the older part of a long thread, so the prompt stays
-- within budget instead of growing with the conversation. Written and read only by
-- the backend (service key), like ai_request_log.
create table if not exists public.thread_summaries (
  thread_id uuid primary key references public.threads(id) on delete cascade,
  summary text not null,
  -- Messages at or before this time are covered by the summary; newer ones go in verbatim.
  covers_through timestamptz not null,
  message_count integer not null default 0,
  model_provider text,
  model_name text,
  updated_at timestamptz not null default now()
);

-- Component #4: one shared memory per project, built from Team Space only (never private
-- threads). items is a JSON array of {id, section, text, sources: [message ids], by: 'ai' |
-- user id}. The AI keeps its own items current; anything a person wrote or edited is theirs
-- and the AI never overwrites it. Decisions aren't stored here: they're read live from pins.
create table if not exists public.project_memory (
  project_id uuid primary key references public.projects(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  -- The newest Team Space message the AI has folded in.
  covers_through timestamptz,
  version integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Feature D (2026-10-02): a project's shared task list. People claim open tasks; exactly one
-- claim wins. Every change goes through the functions in §5 (no direct update or delete).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  details text check (details is null or char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'claimed', 'done')),
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  result text check (result is null or char_length(result) <= 1000),
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  source_message_ids uuid[],
  source_decision_ids uuid[],
  suggested_by_ai boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_open_has_no_claimer check (status <> 'open' or claimed_by is null)
);
create index if not exists tasks_project_status_idx on public.tasks (project_id, status);

-- The "finished" line a completed task posts in Team Space (kind 'task_done', written only by
-- complete_task). Re-adding the kind check keeps this script re-runnable.
alter table public.messages add column if not exists task_id uuid references public.tasks(id) on delete set null;
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('message', 'checkpoint', 'task_done', 'task_review'));

-- Feature D stage 2: coding agents. A person connects a tool (Claude Code, Cursor...) through the
-- "Allow" page; the grant says which project it works on, one project per tool at a time (the user,
-- 2026-10-02). Choir's MCP server checks it on every call; Disconnect sets revoked_at.
create table if not exists public.agent_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id text not null,
  client_name text not null default 'Coding agent' check (char_length(client_name) between 1 and 80),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, client_id)
);

-- A task handed to an agent: the tool's name ("via Claude Code"), the person's private thread for
-- it, and the review card waiting for them (never shown to the team).
alter table public.tasks add column if not exists via_client text;
alter table public.tasks add column if not exists thread_id uuid references public.threads(id) on delete set null;
alter table public.tasks add column if not exists review_message_id uuid references public.messages(id) on delete set null;

-- Agent messages: sender_type 'agent', sender_id = the person it works for, via_client = the tool.
-- A review card is kind 'task_review' with its details in review ({summary, suggested_result,
-- links}) and review_state open | done | sent_back. Only the backend writes these columns.
alter table public.messages drop constraint if exists messages_sender_type_check;
alter table public.messages add constraint messages_sender_type_check check (sender_type in ('user', 'assistant', 'agent'));
alter table public.messages add column if not exists via_client text;
alter table public.messages add column if not exists review jsonb;
alter table public.messages add column if not exists review_state text;
alter table public.messages drop constraint if exists messages_review_state_check;
alter table public.messages add constraint messages_review_state_check
  check (review_state is null or review_state in ('open', 'done', 'sent_back'));

-- ── 1b. Indexes on the columns the app filters by ────────────────────────────
-- Postgres indexes primary keys and unique constraints, but never foreign keys.
-- Without these, opening a thread scans every message and loading the sidebar scans
-- every membership. Creating an index is safe to re-run and keeps all data.
create index if not exists messages_thread_time_idx on public.messages (thread_id, created_at);
create index if not exists threads_project_idx      on public.threads (project_id);
create index if not exists projects_team_idx        on public.projects (team_id);
create index if not exists team_members_user_idx    on public.team_members (user_id);

-- ── 2. Realtime (live sync) ──────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
  -- E4/E5: live status changes and seen-by updates
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'thread_reads'
  ) then
    alter publication supabase_realtime add table public.thread_reads;
  end if;
  -- Component #4: the Project memory panel updates live
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_memory'
  ) then
    alter publication supabase_realtime add table public.project_memory;
  end if;
  -- Feature D: the task list updates live for the whole team
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

-- ── 3. Row Level Security: ON for every table ────────────────────────────────

alter table public.teams            enable row level security;
alter table public.team_members     enable row level security;
alter table public.projects         enable row level security;
alter table public.threads          enable row level security;
alter table public.messages         enable row level security;
alter table public.user_api_keys    enable row level security;
alter table public.team_invitations enable row level security;
alter table public.thread_reads     enable row level security;
alter table public.ai_request_log   enable row level security;
alter table public.notifications    enable row level security;
alter table public.shared_keys      enable row level security;
alter table public.profiles         enable row level security;
alter table public.thread_summaries enable row level security;
alter table public.agent_connections enable row level security;
alter table public.project_memory   enable row level security;
alter table public.tasks            enable row level security;
alter table public.agent_grants     enable row level security;

-- ── 4. Access helpers (same rules as the app and backend access checks) ──────

-- Feature D stage 2 (2026-10-02): a coding agent signed in through Supabase's OAuth server gets
-- the person's own login token plus a client_id claim. Those tokens must never reach data
-- directly (the spike read private threads and keys with one); agents go through Choir's MCP
-- server, which checks their grant. Used by the "Choir app only" rules in §5 and §7.
create or replace function public.is_first_party()
returns boolean
language sql stable
as $$
  select (auth.jwt() ->> 'client_id') is null;
$$;

-- The same rule for every API request, including functions (security definer functions skip
-- the table rules): PostgREST runs this before each request (set up at the end of §5).
create or replace function public.refuse_third_party()
returns void
language plpgsql stable
as $$
begin
  if (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id') is not null then
    raise exception 'Agents connect through Choir''s MCP server, not the database'
      using errcode = '42501';
  end if;
end $$;

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

-- Shared = any team member; private = its owner, while they're still on the team (2026-10-01:
-- someone who left kept their private threads, whose AI reads Team Space; they come back if
-- the person is invited again).
create or replace function public.can_access_thread(p_thread_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from threads t
    join projects p on p.id = t.project_id
    join team_members tm on tm.team_id = p.team_id and tm.user_id = auth.uid()
    where t.id = p_thread_id
      and (t.type = 'shared' or (t.type = 'private' and t.owner_id = auth.uid()))
  );
$$;

-- Team page: owners can remove people, make others owner and delete the team.
create or replace function public.is_team_owner(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- E4: do you and this person share a team? (Used for reading profiles.)
create or replace function public.shares_team(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from team_members mine
    join team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  );
$$;

-- K3/K20 (2026-09-28): the trail/reply checks used to be hand-written inline correlated
-- subqueries directly in the messages insert policy. One of them (reply_to_message_id) let a
-- bare column reference silently shadow onto the subquery's own alias instead of the new row,
-- making the check always false; the identical mistake was found already live and inert in the
-- other one (source_message_ids), masked by its own coalesce fallback. Named functions with
-- p_-prefixed parameters, same convention as the three helpers above, make that class of mistake
-- structurally impossible instead of merely unlikely — a parameter can't be ambiguous with a
-- column name it never matches.
create or replace function public.message_in_thread(p_msg_id uuid, p_target_thread_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from messages where id = p_msg_id and thread_id = p_target_thread_id
  );
$$;

create or replace function public.all_messages_accessible(p_msg_ids uuid[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select bool_and(public.can_access_thread(thread_id)) from messages where id = any (p_msg_ids)),
    true
  );
$$;

-- Component #4: is the caller on the team that owns this project? Same shape as the helpers
-- above, so a project_memory rule can't be shadowed by one of its own columns.
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from projects where id = p_project_id and public.is_team_member(team_id)
  );
$$;

-- Files (2026-09-30): a stored file's path is "<thread id>/<random id>/<file name>", and its
-- first folder decides who may read it: exactly the people who can open that thread. Null for
-- anything that doesn't start with a thread id, so a malformed path is denied, never an error.
create or replace function public.attachment_thread(p_name text)
returns uuid
language sql immutable set search_path = public
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

create or replace function public.can_access_attachment(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.can_access_thread(public.attachment_thread(p_name)), false);
$$;

-- Who may read a stored file: its uploader (while it waits in their composer), and everyone
-- who can open the thread once a live message carries it. So a file you attach and then take
-- out, or haven't sent yet, is never visible to teammates, and a withdrawn post's files stop
-- being reachable the moment it's withdrawn.
create or replace function public.can_read_attachment(p_name text, p_owner_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_access_attachment(p_name)
    and (
      p_owner_id = (select auth.uid())::text
      or exists (
        select 1 from messages m
        where m.thread_id = public.attachment_thread(p_name)
          and m.withdrawn_at is null
          and m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
      )
    );
$$;

-- Upload limits per person, so one account (anyone can sign up) can't fill the project's
-- storage for everyone: at most 300 MB stored in all, and 60 uploads in any hour. Team icons
-- (2026-10-01) count towards the same limits.
create or replace function public.attachment_quota_ok()
returns boolean
language sql stable security definer set search_path = public, storage
as $$
  select
    (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o
      where o.bucket_id in ('attachments', 'team-icons') and o.owner_id = (select auth.uid())::text) < 300 * 1024 * 1024
    and
    (select count(*) from storage.objects o
      where o.bucket_id in ('attachments', 'team-icons') and o.owner_id = (select auth.uid())::text
        and o.created_at > now() - interval '1 hour') < 60;
$$;

-- A message may only list files its sender uploaded, with the stored file's real size and
-- type: no pointing at a teammate's unsent file, and no "invoice.pdf, 2 KB" label on
-- something else. Text comparisons, so a malformed entry is refused, never an error.
create or replace function public.attachments_are_yours(p_attachments jsonb)
returns boolean
language sql stable security definer set search_path = public, storage
as $$
  select case when jsonb_typeof(p_attachments) = 'array' then not exists (
    select 1 from jsonb_array_elements(p_attachments) a
    where not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'attachments'
        and o.name = a ->> 'path'
        and o.owner_id = (select auth.uid())::text
        and o.metadata ->> 'size' = a ->> 'size'
        and o.metadata ->> 'mimetype' = a ->> 'type'
    )
  ) else false end;
$$;

-- A message's attachments list: 1 to 10 files, each inside the message's own thread folder,
-- with a name and a size of at most 10 MB (the bucket enforces the real size on upload).
create or replace function public.attachments_in_thread(p_attachments jsonb, p_thread_id uuid)
returns boolean
language sql immutable set search_path = public
as $$
  -- CASE, not AND: SQL doesn't promise to check "is it a list" before reading it as one.
  select case when jsonb_typeof(p_attachments) = 'array' then
    jsonb_array_length(p_attachments) between 1 and 10
    and not exists (
      select 1 from jsonb_array_elements(p_attachments) a
      where jsonb_typeof(a) <> 'object'
         or public.attachment_thread(a ->> 'path') is distinct from p_thread_id
         or coalesce((a ->> 'path') like '%..%', true)
         or length(coalesce(a ->> 'name', '')) not between 1 and 255
         -- No control characters or invisible direction marks (they can disguise "fdp.exe"
         -- as "exe.pdf").
         or (a ->> 'name') ~ '[[:cntrl:]‎‏‪-‮⁦-⁩]'
         or coalesce(
              case when jsonb_typeof(a -> 'size') = 'number' then (a ->> 'size')::numeric end,
              -1
            ) not between 0 and 10485760
         or length(coalesce(a ->> 'type', '')) > 255
    )
  else false end;
$$;

-- ── 5. Access rules ──────────────────────────────────────────────────────────

-- Remove every old rule on these tables so only the ones below exist
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('teams', 'team_members', 'projects', 'threads', 'messages',
                        'user_api_keys', 'team_invitations', 'thread_reads', 'ai_request_log',
                        'notifications', 'shared_keys', 'profiles', 'thread_summaries', 'agent_connections',
                        'project_memory', 'tasks', 'agent_grants')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Teams: members can see their teams; any member can rename it and change its description
-- and icon (same as Team Space threads: nobody "owns" the workspace more than anyone else);
-- owners delete it (2026-10-01: was the creator only, who may since have left).
create policy "Members can view their teams" on public.teams
  for select using (public.is_team_member(id));
create policy "Team members can rename their teams" on public.teams
  for update using (public.is_team_member(id)) with check (public.is_team_member(id));
create policy "Owners can delete their team" on public.teams
  for delete using (public.is_team_owner(id));

-- Team members: you see your own memberships and your teammates' (the team page lists them
-- with their roles). Nobody inserts, changes or deletes rows directly: joining goes through an
-- invite on the server, leaving and removing through the functions below.
create policy "Members view their teams' memberships" on public.team_members
  for select using (user_id = auth.uid() or public.is_team_member(team_id));

-- Projects: team members can see them
create policy "Members can view projects" on public.projects
  for select using (public.is_team_member(team_id));

-- Threads: shared = team members, private = owner only (while they're on the team). Same rule as
-- can_access_thread, but written against the row itself: that function looks the thread up, and
-- a thread being created isn't there yet, so using it here refused every new private thread.
create policy "View accessible threads" on public.threads
  for select using (
    (type = 'shared' or owner_id = auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = threads.project_id and public.is_team_member(p.team_id)
    )
  );
create policy "Members can create own private threads" on public.threads
  for insert with check (
    type = 'private'
    and owner_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and public.is_team_member(p.team_id)
    )
    -- D2: can only fork from a message you can see
    and (forked_from_message_id is null or exists (
      select 1 from public.messages m
      where m.id = forked_from_message_id and public.can_access_thread(m.thread_id)
    ))
  );
create policy "Owners can delete own private threads" on public.threads
  for delete using (type = 'private' and owner_id = auth.uid());
create policy "Owners can update own private threads" on public.threads
  for update
  using (type = 'private' and owner_id = auth.uid())
  with check (type = 'private' and owner_id = auth.uid());
-- L16: renaming Team Space. Any team member, not just the creator — owner_id is
-- null on shared threads (nobody "owns" Team Space more than anyone else), and
-- every other shared-thread action (pinning, posting) is already open to the
-- whole team on equal footing.
create policy "Team members can rename shared threads" on public.threads
  for update
  using (type = 'shared' and exists (
    select 1 from public.projects p
    where p.id = threads.project_id and public.is_team_member(p.team_id)
  ))
  with check (type = 'shared' and exists (
    select 1 from public.projects p
    where p.id = threads.project_id and public.is_team_member(p.team_id)
  ));
-- L23: RLS can't scope a policy to one column, so the rename policy above would also
-- let any member flip ai_auto_reply on Team Space. Mute is private-thread only.
create or replace function public.block_shared_auto_reply_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.type = 'shared' and new.ai_auto_reply is distinct from old.ai_auto_reply then
    raise exception 'AI replies can only be changed on private threads' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists block_shared_auto_reply_change on public.threads;
create trigger block_shared_auto_reply_change
  before update on public.threads
  for each row execute function public.block_shared_auto_reply_change();

-- Messages: only in threads the user can access; users post as themselves;
-- pinning (update) only in shared threads. AI replies are saved by the backend.
create policy "View messages in accessible threads" on public.messages
  for select using (public.can_access_thread(thread_id));
create policy "Send messages as yourself in accessible threads" on public.messages
  for insert with check (
    sender_type = 'user'
    and sender_id = auth.uid()
    and public.can_access_thread(thread_id)
    -- K2: a published post can only point back to a thread you can see
    and (source_thread_id is null or public.can_access_thread(source_thread_id))
    -- B3 finding: "shared by" can only be yourself
    and (shared_by is null or shared_by = auth.uid())
    -- K3: the trail can only point at messages you can see. See the function's own comment
    -- (§4 above) for why this is a named function rather than an inline subquery.
    and (source_message_ids is null or public.all_messages_accessible(source_message_ids))
    -- A reply can only point at a message already in the same thread. Same reasoning as K3.
    and (reply_to_message_id is null or public.message_in_thread(reply_to_message_id, thread_id))
    -- Files can only come from this thread's own folder (a private file can't be pulled
    -- into Team Space by pointing at it; publishing copies it instead).
    and (attachments is null or (
      public.attachments_in_thread(attachments, thread_id) and public.attachments_are_yours(attachments)
    ))
  );
create policy "Pin messages in accessible shared threads" on public.messages
  for update
  using (
    public.can_access_thread(thread_id)
    and exists (select 1 from public.threads t where t.id = thread_id and t.type = 'shared')
  )
  with check (
    public.can_access_thread(thread_id)
    and exists (select 1 from public.threads t where t.id = thread_id and t.type = 'shared')
    -- B3 finding: a pin can only be credited to yourself
    and (pinned_by is null or pinned_by = auth.uid())
    -- A withdrawn post can't be pinned again.
    and (withdrawn_at is null or not is_decision)
    -- A compact checkpoint is a context summary, never a team Decision. A task's "finished"
    -- line may be pinned like any message.
    and (kind <> 'checkpoint' or not is_decision)
  );

-- Withdraw your own publication (a post made from a private thread). Clears its text
-- and trail, removes it from Decisions, and drops Team Space's stored AI summary so the
-- next AI reply rebuilds it without the withdrawn text. An UPDATE, not a DELETE, so
-- other open tabs get it live and replies quoting it still resolve. Security definer
-- because signed-in users can't update message content directly (column grants below).
create or replace function public.withdraw_publication(p_message_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_thread_id uuid;
  v_created_at timestamptz;
begin
  update messages
     set content = '', source_message_ids = null, attachments = null, withdrawn_at = now(),
         is_decision = false, pinned_by = null, pinned_at = null
   where id = p_message_id
     and sender_id = auth.uid()
     and shared_by is not null
     and withdrawn_at is null
  returning thread_id, created_at into v_thread_id, v_created_at;

  if v_thread_id is null then
    raise exception 'You can only withdraw your own posts from a private thread' using errcode = '42501';
  end if;

  delete from thread_summaries where thread_id = v_thread_id;
  -- Component #4: compact checkpoints that summarised it are undone (the AI rebuilds one
  -- without it), and project memory items that cite it are dropped.
  update messages set withdrawn_at = now()
   where thread_id = v_thread_id and kind = 'checkpoint' and withdrawn_at is null
     and covers_through >= v_created_at;
  update project_memory pm
     set items = coalesce((
           select jsonb_agg(item) from jsonb_array_elements(pm.items) item
            where not coalesce(item -> 'sources', '[]'::jsonb) ? p_message_id::text
         ), '[]'::jsonb),
         version = pm.version + 1, updated_at = now()
   where pm.project_id = (select t.project_id from threads t where t.id = v_thread_id);
end $$;
revoke execute on function public.withdraw_publication(uuid) from public, anon;
grant execute on function public.withdraw_publication(uuid) to authenticated;

-- Team page (2026-10-01): taking someone off a team. Their keys stop being lent to its projects,
-- coding agents they connected leave with them, and invite links they made stop working.
-- Their messages stay (shown under their name); their private threads stay saved but closed
-- (can_access_thread needs membership) until they're invited again. Internal: called only by
-- leave_team and remove_member below.
create or replace function public.drop_team_member(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from shared_keys
   where user_id = p_user_id
     and project_id in (select id from projects where team_id = p_team_id);
  delete from agent_connections
   where owner_id = p_user_id
     and project_id in (select id from projects where team_id = p_team_id);
  -- Feature D stage 2: their coding agents stop working on this team's projects.
  update agent_grants set revoked_at = now()
   where user_id = p_user_id and revoked_at is null
     and project_id in (select id from projects where team_id = p_team_id);
  delete from team_members
   where team_id = p_team_id
     and user_id in (select id from profiles where kind = 'agent' and owner_id = p_user_id);
  update team_invitations set revoked_at = now()
   where team_id = p_team_id and created_by = p_user_id and revoked_at is null;
  -- Feature D: tasks they had claimed go back to the team.
  update tasks set status = 'open', claimed_by = null, claimed_at = null, updated_at = now()
   where claimed_by = p_user_id and status = 'claimed'
     and project_id in (select id from projects where team_id = p_team_id);
  delete from team_members where team_id = p_team_id and user_id = p_user_id;
end $$;
revoke execute on function public.drop_team_member(uuid, uuid) from public, anon, authenticated;

-- Anyone can leave. The last owner's leaving makes the longest-standing person owner; the last
-- person's leaving deletes the team. Returns 'left', 'left_new_owner' or 'deleted'.
create or replace function public.leave_team(p_team_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_next uuid;
begin
  -- Locks the team's rows, so two people leaving at once can't both skip the hand-over.
  perform 1 from team_members where team_id = p_team_id for update;
  select role into v_role from team_members where team_id = p_team_id and user_id = auth.uid();
  if v_role is null then
    raise exception 'You are not in this team' using errcode = '42501';
  end if;

  -- People left besides you (agents don't count: they act for someone).
  if not exists (
    select 1 from team_members tm left join profiles pr on pr.id = tm.user_id
     where tm.team_id = p_team_id and tm.user_id <> auth.uid() and coalesce(pr.kind, 'human') = 'human'
  ) then
    delete from teams where id = p_team_id;
    return 'deleted';
  end if;

  perform drop_team_member(p_team_id, auth.uid());

  if v_role = 'owner' and not exists (select 1 from team_members where team_id = p_team_id and role = 'owner') then
    select tm.user_id into v_next
      from team_members tm left join profiles pr on pr.id = tm.user_id
     where tm.team_id = p_team_id and coalesce(pr.kind, 'human') = 'human'
     order by tm.joined_at asc nulls last, tm.user_id
     limit 1;
    update team_members set role = 'owner' where team_id = p_team_id and user_id = v_next;
    return 'left_new_owner';
  end if;
  return 'left';
end $$;
revoke execute on function public.leave_team(uuid) from public, anon;
grant execute on function public.leave_team(uuid) to authenticated;

-- Owners remove someone else (yourself: leave_team). p_revoke_invites also stops every active
-- invite link, so the person can't rejoin with a link they were sent earlier.
create or replace function public.remove_member(p_team_id uuid, p_user_id uuid, p_revoke_invites boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_team_owner(p_team_id) then
    raise exception 'Only owners can remove people' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use leave_team to leave' using errcode = '22023';
  end if;
  if not exists (select 1 from team_members where team_id = p_team_id and user_id = p_user_id) then
    raise exception 'That person is not in this team' using errcode = '22023';
  end if;
  perform drop_team_member(p_team_id, p_user_id);
  if p_revoke_invites then
    update team_invitations set revoked_at = now() where team_id = p_team_id and revoked_at is null;
  end if;
end $$;
revoke execute on function public.remove_member(uuid, uuid, boolean) from public, anon;
grant execute on function public.remove_member(uuid, uuid, boolean) to authenticated;

-- Owners make another person (never an agent) an owner too.
create or replace function public.make_owner(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_team_owner(p_team_id) then
    raise exception 'Only owners can make someone an owner' using errcode = '42501';
  end if;
  update team_members tm set role = 'owner'
   where tm.team_id = p_team_id and tm.user_id = p_user_id
     and not exists (select 1 from profiles pr where pr.id = p_user_id and pr.kind = 'agent');
  if not found then
    raise exception 'Only people in this team can become owners' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.make_owner(uuid, uuid) from public, anon;
grant execute on function public.make_owner(uuid, uuid) to authenticated;

-- API keys: only your own (the backend reads them with the service key)
create policy "Manage own API keys" on public.user_api_keys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Agent connections: only the person who connected an agent can see or revoke it.
-- Never touched by the agent's own requests — those go through the backend's
-- service-role client after it verifies the token itself.
create policy "Manage own agent connections" on public.agent_connections
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Invitations: team members only — no public reading of tokens.
-- Accepting an invite uses the server's admin client, so it still works.
-- (B3 finding: split so links are created in your own name and a revoke can't be undone.)
create policy "Members view team invitations" on public.team_invitations
  for select using (public.is_team_member(team_id));
create policy "Members create invitations as themselves" on public.team_invitations
  for insert with check (public.is_team_member(team_id) and created_by = auth.uid());
create policy "Members revoke team invitations" on public.team_invitations
  for update using (public.is_team_member(team_id))
  with check (public.is_team_member(team_id) and revoked_at is not null);
create policy "Members delete team invitations" on public.team_invitations
  for delete using (public.is_team_member(team_id));

-- Catch Me Up position: only your own, and only for threads you can open (B3 finding)
create policy "Manage own read state" on public.thread_reads
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_access_thread(thread_id));

-- Profiles: you see your own and your teammates'; you edit only your own name and status.
create policy "View own and teammates' profiles" on public.profiles
  for select using (id = auth.uid() or public.shares_team(id));
create policy "Update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- The sign-up trigger normally creates the row. This lets the app fill in a missing
-- one for the signed-in person (and nobody else), so a failed trigger isn't fatal.
create policy "Create own profile" on public.profiles
  for insert with check (id = auth.uid());

-- ai_request_log and thread_summaries: no rules on purpose — only the backend
-- touches them, with the service key. RLS is on, so nobody else can read either.

-- Notifications: you see and mark read only your own; the backend creates them.
create policy "View own notifications" on public.notifications
  for select using (user_id = auth.uid());
create policy "Mark own notifications read" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Shared keys: team members can see who lends a key to the project (never the key
-- itself); you can only lend your own saved key, to a project in your team.
create policy "Members view shared keys" on public.shared_keys
  for select using (exists (
    select 1 from public.projects p
    where p.id = project_id and public.is_team_member(p.team_id)
  ));
create policy "Lend your own key" on public.shared_keys
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and public.is_team_member(p.team_id)
    )
    and exists (
      select 1 from public.user_api_keys k
      where k.id = key_id and k.user_id = auth.uid() and k.provider = shared_keys.provider
    )
  );
create policy "Change your own shared key" on public.shared_keys
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Stop lending your own key" on public.shared_keys
  for delete using (user_id = auth.uid());

-- Project memory (component #4): the whole team reads it; any member edits it, in their own
-- name. The backend writes the AI's updates with the service key.
create policy "Members view project memory" on public.project_memory
  for select using (public.is_project_member(project_id));
create policy "Members create project memory as themselves" on public.project_memory
  for insert with check (public.is_project_member(project_id) and updated_by = auth.uid());
create policy "Members edit project memory as themselves" on public.project_memory
  for update using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id) and updated_by = auth.uid());

-- Tasks (feature D): the team reads its project's list; anyone on the team adds open tasks in
-- their own name, pointing only at messages they can see. Every other change goes through the
-- functions below, which decide who may do what (column grants in §6 block direct writes).
create policy "Members view their project's tasks" on public.tasks
  for select using (public.is_project_member(project_id));
create policy "Members add open tasks as themselves" on public.tasks
  for insert with check (
    public.is_project_member(project_id)
    and created_by = auth.uid()
    and (source_message_ids is null or public.all_messages_accessible(source_message_ids))
    and (source_decision_ids is null or public.all_messages_accessible(source_decision_ids))
  );

-- Feature D stage 2: you see and disconnect your own coding agents. They're added only through
-- connect_agent (below), which checks the project is yours.
create policy "View your own agent grants" on public.agent_grants
  for select using (user_id = auth.uid());
create policy "Disconnect your own agents" on public.agent_grants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid() and revoked_at is not null);

-- Is the caller an owner of the team this task belongs to? Owners can release, edit and reopen
-- anyone's task (someone went quiet, or left a task half done).
create or replace function public.task_team_owner(p_task_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from tasks t join projects p on p.id = t.project_id
     where t.id = p_task_id and public.is_team_owner(p.team_id)
  )
$$;
revoke execute on function public.task_team_owner(uuid) from public, anon, authenticated;

-- Claim an open task. One conditional update: a second, simultaneous claim waits for the first
-- and then finds the task no longer open, so exactly one wins. Returns who has the task now
-- (you if you won), so the loser can be told who got it.
create or replace function public.claim_task(p_task_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
  v_claimer uuid;
begin
  select project_id into v_project from tasks where id = p_task_id;
  if v_project is null or not public.is_project_member(v_project) then
    raise exception 'You can only claim tasks in your own team' using errcode = '42501';
  end if;
  update tasks set status = 'claimed', claimed_by = auth.uid(), claimed_at = now(), updated_at = now()
   where id = p_task_id and status = 'open' and claimed_by is null;
  select claimed_by into v_claimer from tasks where id = p_task_id;
  return v_claimer;
end $$;

create or replace function public.release_task(p_task_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update tasks set status = 'open', claimed_by = null, claimed_at = null, via_client = null, updated_at = now()
   where id = p_task_id and status = 'claimed'
     and (claimed_by = auth.uid() or public.task_team_owner(p_task_id));
  if not found then
    raise exception 'Only the person who claimed it, or a team owner, can release it' using errcode = '42501';
  end if;
end $$;

-- Mark your claimed task done, with an optional result. Posts the "finished" line in Team Space
-- in the same transaction, so the list and the chat never disagree.
create or replace function public.complete_task(p_task_id uuid, p_result text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_shared uuid;
  v_result text := nullif(btrim(coalesce(p_result, '')), '');
  v_message uuid;
begin
  select * into v_task from tasks where id = p_task_id;
  if v_task.id is null or not public.is_project_member(v_task.project_id) then
    raise exception 'Task not found' using errcode = '42501';
  end if;
  if v_task.status = 'done' then
    raise exception 'This task is already done';
  end if;
  if v_task.status <> 'claimed' or v_task.claimed_by is distinct from auth.uid() then
    raise exception 'Only the person who claimed it can mark it done' using errcode = '42501';
  end if;
  if char_length(coalesce(v_result, '')) > 1000 then
    raise exception 'Keep the result under 1000 characters';
  end if;

  update tasks set status = 'done', result = v_result, done_at = now(), done_by = auth.uid(),
                   review_message_id = null, updated_at = now()
   where id = p_task_id;
  -- An agent's review card waiting in the task thread is answered by this.
  update messages set review_state = 'done' where id = v_task.review_message_id and review_state = 'open';
  select id into v_shared from threads where project_id = v_task.project_id and type = 'shared' limit 1;
  insert into messages (thread_id, sender_type, sender_id, content, kind, task_id)
  values (
    v_shared, 'user', auth.uid(),
    'Finished the task "' || v_task.title || '".' || coalesce(E'\n\nResult: ' || v_result, ''),
    'task_done', p_task_id
  )
  returning id into v_message;
  return v_message;
end $$;

create or replace function public.reopen_task(p_task_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update tasks set status = 'claimed', result = null, done_at = null, done_by = null, updated_at = now()
   where id = p_task_id and status = 'done' and claimed_by is not null
     and (claimed_by = auth.uid() or public.task_team_owner(p_task_id));
  if not found then
    raise exception 'Only the person who did it, or a team owner, can reopen it' using errcode = '42501';
  end if;
end $$;

-- Open tasks: anyone on the team edits them. Claimed or done: the claimer or a team owner.
create or replace function public.edit_task(p_task_id uuid, p_title text, p_details text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update tasks set title = btrim(p_title), details = nullif(btrim(coalesce(p_details, '')), ''), updated_at = now()
   where id = p_task_id
     and public.is_project_member(project_id)
     and (status = 'open' or claimed_by = auth.uid() or public.task_team_owner(p_task_id));
  if not found then
    raise exception 'Only the person who claimed it, or a team owner, can edit it' using errcode = '42501';
  end if;
end $$;

-- Only open tasks are deleted: a task someone promised to do never silently disappears.
create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from tasks where id = p_task_id and public.is_project_member(project_id);
  if v_status is null then
    raise exception 'Task not found' using errcode = '42501';
  end if;
  if v_status <> 'open' then
    raise exception 'Release or reopen it before deleting: someone has taken it on';
  end if;
  delete from tasks where id = p_task_id;
end $$;

-- Feature D stage 2: send an agent's work back. The claimer's note goes into the task's private
-- thread as their own message (the agent reads it there) and the review card shows "Sent back";
-- the task stays theirs. Returns the note's message id.
create or replace function public.send_back_task(p_task_id uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_message uuid;
begin
  select * into v_task from tasks where id = p_task_id;
  if v_task.id is null or v_task.status <> 'claimed' or v_task.claimed_by is distinct from auth.uid()
     or not coalesce(public.can_access_thread(v_task.thread_id), false) then
    raise exception 'Only the person who claimed it can send it back' using errcode = '42501';
  end if;
  if v_task.review_message_id is null then
    raise exception 'There''s no review waiting on this task';
  end if;
  if char_length(v_note) not between 1 and 2000 then
    raise exception 'Say what to change (up to 2000 characters)';
  end if;
  update messages set review_state = 'sent_back' where id = v_task.review_message_id;
  update tasks set review_message_id = null, updated_at = now() where id = p_task_id;
  insert into messages (thread_id, sender_type, sender_id, content, task_id)
  values (v_task.thread_id, 'user', auth.uid(), v_note, p_task_id)
  returning id into v_message;
  return v_message;
end $$;

-- Feature D stage 2: the "Allow" page connects a tool to one of your projects. Connecting the same
-- tool again moves it to the new project (one project per tool, the user's choice 2026-10-02).
create or replace function public.connect_agent(p_client_id text, p_client_name text, p_project_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_grant uuid;
begin
  if not public.is_project_member(p_project_id) then
    raise exception 'You can only connect a tool to your own team''s project' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_client_id, ''))) = 0 then
    raise exception 'Missing tool id';
  end if;
  insert into agent_grants (user_id, project_id, client_id, client_name)
  values (auth.uid(), p_project_id, p_client_id,
          coalesce(nullif(left(btrim(coalesce(p_client_name, '')), 80), ''), 'Coding agent'))
  on conflict (user_id, client_id) do update
    set project_id = excluded.project_id, client_name = excluded.client_name,
        created_at = now(), last_used_at = null, revoked_at = null
  returning id into v_grant;
  return v_grant;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['claim_task(uuid)', 'release_task(uuid)', 'complete_task(uuid, text)',
                           'reopen_task(uuid)', 'edit_task(uuid, text, text)', 'delete_task(uuid)',
                           'send_back_task(uuid, text)', 'connect_agent(text, text, uuid)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Feature D stage 2: only the Choir app's own logins reach data (see is_first_party). One
-- restrictive rule per table: Postgres combines it with AND, so every rule above still decides
-- who sees what, and an agent's token sees nothing, live updates included. Covers every public
-- table with RLS on, so a new table is covered without being listed.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists "Choir app only" on public.%I', t);
    execute format(
      'create policy "Choir app only" on public.%I as restrictive for all to authenticated '
      'using (public.is_first_party()) with check (public.is_first_party())', t);
  end loop;
end $$;

-- And before every API request, so agent tokens can't call the functions above either.
alter role authenticator set pgrst.db_pre_request = 'public.refuse_third_party';
notify pgrst, 'reload config';

-- ── 6. Column permissions ────────────────────────────────────────────────────

-- Signed-in users may only change a message's pin fields, never its content or
-- sender. The rule above decides *which* messages; this decides *which columns*.
revoke update on public.messages from anon, authenticated;
grant update (is_decision, pinned_by, pinned_at) on public.messages to authenticated;

-- B3 finding: new messages can't arrive pre-pinned or backdated. Only these columns
-- may be set when posting (id is sent by the app for optimistic sends).
revoke insert on public.messages from anon, authenticated;
grant insert (id, thread_id, sender_type, sender_id, content, shared_by, source_thread_id,
              source_message_ids, reply_to_message_id, publish_edited, attachments)
  on public.messages to authenticated;

-- Any team member may rename it and change its description and icon (see "Team members can
-- rename their teams" above); never its creator or creation time.
revoke update on public.teams from anon, authenticated;
grant update (name, description, icon_kind, icon_name, icon_color, icon_path) on public.teams to authenticated;

-- Signed-in users may change a thread's AI auto-reply setting (mute) or its name,
-- never its type, owner or project. The two policies above decide who may touch
-- which rows: auto-reply only ever matters on your own private thread anyway, and
-- the "Owners can update..." / "Team members can rename..." policies keep name
-- changes scoped to threads a user actually owns or is a teammate on.
revoke update on public.threads from anon, authenticated;
grant update (ai_auto_reply, name) on public.threads to authenticated;

-- L5: members may only revoke an invite link, never change its token, team or expiry.
revoke update on public.team_invitations from anon, authenticated;
grant update (revoked_at) on public.team_invitations to authenticated;
-- B3 finding: links are created with the default 7-day expiry, never a custom one.
revoke insert on public.team_invitations from anon, authenticated;
grant insert (team_id, created_by) on public.team_invitations to authenticated;

-- F3: users may only mark a notification read.
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- F4/F5: users may only switch a lent key between fallback and pool.
revoke update on public.shared_keys from anon, authenticated;
grant update (mode) on public.shared_keys to authenticated;

-- E4: people may only change their own display name and status, never anyone's id.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, status, updated_at, seen_onboarding_tour) on public.profiles to authenticated;
-- A self-created profile row sets only these columns; the rule above pins id to yourself.
revoke insert on public.profiles from anon, authenticated;
grant insert (id, display_name, status) on public.profiles to authenticated;

-- E5: a read position may set both timestamps, nothing else.
revoke update on public.thread_reads from anon, authenticated;
grant update (last_seen_at, last_read_at) on public.thread_reads to authenticated;

-- Component #4: members edit project memory's items in their own name; only the backend
-- sets covers_through (what the AI has read).
revoke insert, update, delete on public.project_memory from anon, authenticated;
grant insert (project_id, items, version, updated_by) on public.project_memory to authenticated;
grant update (items, version, updated_by, updated_at) on public.project_memory to authenticated;

-- Feature D: tasks are added with these columns only; status, claimer and result change only
-- through the task functions (§5).
revoke insert, update, delete on public.tasks from anon, authenticated;
grant insert (project_id, title, details, source_message_ids, source_decision_ids, suggested_by_ai, created_by)
  on public.tasks to authenticated;

-- Feature D stage 2: Disconnect is the only direct change people make to a grant.
revoke insert, update, delete on public.agent_grants from anon, authenticated;
grant update (revoked_at) on public.agent_grants to authenticated;

-- ── 7. File storage (2026-09-30) ─────────────────────────────────────────────
-- One private bucket; files are only ever reached through short-lived signed links, which
-- the storage server hands out only to people these rules allow. 10 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = null;

drop policy if exists "Choir: read files in threads you can open" on storage.objects;
drop policy if exists "Choir: add files to threads you can open" on storage.objects;
drop policy if exists "Choir: remove your own files" on storage.objects;
create policy "Choir: read files in threads you can open" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.can_read_attachment(name, owner_id));
create policy "Choir: add files to threads you can open" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_access_attachment(name) and public.attachment_quota_ok());
-- Only the uploader removes a file (a withdrawn post's copies, or one taken out of the
-- composer before sending). No update rule: a stored file is never replaced or moved.
create policy "Choir: remove your own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = (select auth.uid())::text and public.can_access_attachment(name));

-- Team icons (2026-10-01): a public bucket, because the rail shows icons on every page and a
-- team icon isn't secret (its path is random). Only a team's members add or remove images in
-- its folder ("<team id>/<random>.webp"; attachment_thread reads the first folder as a uuid);
-- uploads count towards the per-person limits above. 2 MB, PNG/JPEG/WebP only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-icons', 'team-icons', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists "Choir: members add their team's icon" on storage.objects;
drop policy if exists "Choir: members remove their team's icon" on storage.objects;
drop policy if exists "Choir: members look up their team's icon" on storage.objects;
-- Viewing goes through the public link; this lookup is what lets a member remove an old icon
-- (storage only deletes files the caller may look up).
create policy "Choir: members look up their team's icon" on storage.objects
  for select to authenticated
  using (bucket_id = 'team-icons' and coalesce(public.is_team_member(public.attachment_thread(name)), false));
create policy "Choir: members add their team's icon" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'team-icons'
    and coalesce(public.is_team_member(public.attachment_thread(name)), false)
    and public.attachment_quota_ok()
  );
create policy "Choir: members remove their team's icon" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-icons' and coalesce(public.is_team_member(public.attachment_thread(name)), false));

-- Feature D stage 2: agents' tokens can't read, add or remove files either (see §5's rule).
drop policy if exists "Choir app only" on storage.objects;
create policy "Choir app only" on storage.objects
  as restrictive for all to authenticated
  using (public.is_first_party()) with check (public.is_first_party());

commit;
