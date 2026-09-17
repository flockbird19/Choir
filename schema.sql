-- ============================================================================
-- Choir database schema — one script, safe to re-run
-- Creates what's missing, keeps all data, keeps RLS ON, resets all access rules.
--
-- This file is the source of truth for the live database. To change the
-- database: edit this file, paste the whole script into the Supabase SQL Editor
-- ("Choir schema" snippet) and run it. Last applied to live: 2026-09-16. Pending re-run
-- (2026-09-17, Batch 1): threads.forked_from_message_id (D2), messages.source_thread_id
-- (K2), invite expiry/revoke (L5), notifications (F3), shared_keys (F4/F5).
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
                           'notifications', 'shared_keys']
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

-- ── 4. Access helpers (same rules as the app and backend access checks) ──────

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.can_access_thread(p_thread_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from threads t
    join projects p on p.id = t.project_id
    where t.id = p_thread_id
      and (
        (t.type = 'private' and t.owner_id = auth.uid())
        or (t.type = 'shared' and exists (
          select 1 from team_members tm
          where tm.team_id = p.team_id and tm.user_id = auth.uid()
        ))
      )
  );
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
                        'notifications', 'shared_keys')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Teams: members can see their teams; the creator can delete
create policy "Members can view their teams" on public.teams
  for select using (public.is_team_member(id));
create policy "Creator can delete team" on public.teams
  for delete using (created_by = auth.uid());

-- Team members: users see their own memberships
create policy "Users can view own memberships" on public.team_members
  for select using (user_id = auth.uid());

-- Projects: team members can see them
create policy "Members can view projects" on public.projects
  for select using (public.is_team_member(team_id));

-- Threads: shared = team members, private = owner only
create policy "View accessible threads" on public.threads
  for select using (
    (type = 'private' and owner_id = auth.uid())
    or (type = 'shared' and exists (
      select 1 from public.projects p
      where p.id = threads.project_id and public.is_team_member(p.team_id)
    ))
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
  );

-- API keys: only your own (the backend reads them with the service key)
create policy "Manage own API keys" on public.user_api_keys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

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

-- ai_request_log: no rules on purpose — only the backend touches it.

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

-- ── 6. Column permissions ────────────────────────────────────────────────────

-- Signed-in users may only change a message's pin fields, never its content or
-- sender. The rule above decides *which* messages; this decides *which columns*.
revoke update on public.messages from anon, authenticated;
grant update (is_decision, pinned_by, pinned_at) on public.messages to authenticated;

-- B3 finding: new messages can't arrive pre-pinned or backdated. Only these columns
-- may be set when posting (id is sent by the app for optimistic sends).
revoke insert on public.messages from anon, authenticated;
grant insert (id, thread_id, sender_type, sender_id, content, shared_by, source_thread_id)
  on public.messages to authenticated;

-- Signed-in users may only change a thread's AI auto-reply setting (mute), never its
-- type, owner, project or name. The rule above limits this to their own private threads.
revoke update on public.threads from anon, authenticated;
grant update (ai_auto_reply) on public.threads to authenticated;

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

commit;
