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
                           'notifications', 'shared_keys', 'profiles', 'thread_summaries', 'agent_connections']
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
                        'notifications', 'shared_keys', 'profiles', 'thread_summaries', 'agent_connections')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Teams: members can see their teams; any member can rename it (same as Team Space
-- threads: nobody "owns" the workspace more than anyone else); only the creator can delete.
create policy "Members can view their teams" on public.teams
  for select using (public.is_team_member(id));
create policy "Team members can rename their teams" on public.teams
  for update using (public.is_team_member(id));
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
begin
  update messages
     set content = '', source_message_ids = null, withdrawn_at = now(),
         is_decision = false, pinned_by = null, pinned_at = null
   where id = p_message_id
     and sender_id = auth.uid()
     and shared_by is not null
     and withdrawn_at is null
  returning thread_id into v_thread_id;

  if v_thread_id is null then
    raise exception 'You can only withdraw your own posts from a private thread' using errcode = '42501';
  end if;

  delete from thread_summaries where thread_id = v_thread_id;
end $$;
revoke execute on function public.withdraw_publication(uuid) from public, anon;
grant execute on function public.withdraw_publication(uuid) to authenticated;

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

-- ── 6. Column permissions ────────────────────────────────────────────────────

-- Signed-in users may only change a message's pin fields, never its content or
-- sender. The rule above decides *which* messages; this decides *which columns*.
revoke update on public.messages from anon, authenticated;
grant update (is_decision, pinned_by, pinned_at) on public.messages to authenticated;

-- B3 finding: new messages can't arrive pre-pinned or backdated. Only these columns
-- may be set when posting (id is sent by the app for optimistic sends).
revoke insert on public.messages from anon, authenticated;
grant insert (id, thread_id, sender_type, sender_id, content, shared_by, source_thread_id,
              source_message_ids, reply_to_message_id, publish_edited)
  on public.messages to authenticated;

-- Any team member may rename it (see "Team members can rename their teams" above).
revoke update on public.teams from anon, authenticated;
grant update (name) on public.teams to authenticated;

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

commit;
