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

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================

-- Enable RLS on all tables
alter table teams enable row level security;
alter table team_members enable row level security;
alter table projects enable row level security;
alter table threads enable row level security;
alter table messages enable row level security;
alter table user_api_keys enable row level security;

-- Teams & Projects (Basic read access for team members)
create policy "Team members can view teams" on teams for select using (
  exists (select 1 from team_members where team_id = teams.id and user_id = auth.uid())
);
create policy "Team members can view projects" on projects for select using (
  exists (select 1 from team_members where team_id = projects.team_id and user_id = auth.uid())
);

-- Threads Policy
create policy "View shared or owned threads" on threads for select using (
  (type = 'shared' and exists (
    select 1 from projects p
    join team_members tm on p.team_id = tm.team_id
    where p.id = threads.project_id and tm.user_id = auth.uid()
  ))
  or 
  (owner_id = auth.uid())
);

-- Messages Policy (Relies on thread access)
create policy "View messages in accessible threads" on messages for select using (
  exists (select 1 from threads where id = messages.thread_id)
);

-- API Keys Policy
create policy "Manage own API keys" on user_api_keys for all using (
  user_id = auth.uid()
);
