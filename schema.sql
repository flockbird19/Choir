-- ==========================================
-- 1. TABLES
-- ==========================================

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists team_members (
  team_id uuid references teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'member',
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id),
  shared_model_provider text default 'anthropic',
  shared_model_name text default 'claude-sonnet-5',
  shared_model_key_id uuid,
  created_at timestamptz default now()
);

create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  type text not null check (type in ('shared', 'private')),
  owner_id uuid references auth.users(id),
  name text,
  model_provider text,
  model_name text,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'assistant')),
  sender_id uuid references auth.users(id),
  content text not null,
  model_provider text,
  model_name text,
  created_at timestamptz default now(),
  shared_by uuid references auth.users(id)
);

create table if not exists user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  encrypted_key text not null, 
  created_at timestamptz default now(),
  unique (user_id, provider)
);

create table if not exists team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  token uuid default gen_random_uuid() unique,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ==========================================
-- 2. ENABLE ROW LEVEL SECURITY (RLS)
-- ==========================================

alter table teams enable row level security;
alter table team_members enable row level security;
alter table projects enable row level security;
alter table threads enable row level security;
alter table messages enable row level security;
alter table user_api_keys enable row level security;
alter table team_invitations enable row level security;

-- ==========================================
-- 3. RLS POLICIES (With Drop If Exists to prevent errors)
-- ==========================================

-- ── Teams ─────────────────────────────────
drop policy if exists "Team members can view teams" on teams;
create policy "Team members can view teams" on teams for select using (
  exists (select 1 from team_members where team_id = teams.id and user_id = auth.uid())
);

-- ── Team Members ──────────────────────────
drop policy if exists "Users can view their own team memberships" on team_members;
create policy "Users can view their own team memberships" on team_members for select using (
  user_id = auth.uid()
);

drop policy if exists "Team members can view others in team" on team_members;

drop policy if exists "Team owners can delete teams" on teams;
create policy "Team owners can delete teams" on teams for delete using (
  created_by = auth.uid()
);

-- ── Projects ──────────────────────────────
drop policy if exists "Team members can view projects" on projects;
create policy "Team members can view projects" on projects for select using (
  exists (select 1 from team_members where team_id = projects.team_id and user_id = auth.uid())
);

-- ── Threads ───────────────────────────────
drop policy if exists "View shared or owned threads" on threads;
create policy "View shared or owned threads" on threads for select using (
  (type = 'shared' and exists (
    select 1 from projects p
    join team_members tm on p.team_id = tm.team_id
    where p.id = threads.project_id and tm.user_id = auth.uid()
  ))
  or 
  (owner_id = auth.uid())
);

drop policy if exists "Users can insert private threads" on threads;
create policy "Users can insert private threads" on threads for insert with check (
  owner_id = auth.uid()
);

drop policy if exists "Users can delete own threads" on threads;
create policy "Users can delete own threads" on threads for delete using (
  owner_id = auth.uid()
);

-- ── Messages ──────────────────────────────
drop policy if exists "View messages in accessible threads" on messages;
create policy "View messages in accessible threads" on messages for select using (
  exists (select 1 from threads where id = messages.thread_id)
);

drop policy if exists "Users can insert messages" on messages;
create policy "Users can insert messages" on messages for insert with check (
  exists (select 1 from threads where id = messages.thread_id)
);

-- ── API Keys ──────────────────────────────
drop policy if exists "Manage own API keys" on user_api_keys;
create policy "Manage own API keys" on user_api_keys for all using (
  user_id = auth.uid()
);

-- ── Invitations ───────────────────────────
drop policy if exists "Team members can manage invitations" on team_invitations;
create policy "Team members can manage invitations" on team_invitations for all using (
  exists (select 1 from team_members where team_id = team_invitations.team_id and user_id = auth.uid())
);

drop policy if exists "Anyone can read invitation by token" on team_invitations;
create policy "Anyone can read invitation by token" on team_invitations for select using (
  true
);
