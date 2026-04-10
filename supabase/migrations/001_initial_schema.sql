-- SDR Jarvis — Initial Schema
-- Run via: supabase db push

create extension if not exists "uuid-ossp";
create extension if not exists "vector";
create extension if not exists "pg_trgm";

-- ════════════════════════════════════════════════════
-- PROFILES (extends Supabase auth.users)
-- ════════════════════════════════════════════════════

create table public.profiles (
  id            uuid references auth.users on delete cascade primary key,
  full_name     text,
  company_name  text,
  role          text,
  icp_description text,
  tone_preferences jsonb default '{"formality": "professional-casual", "humor": true, "signoff": "Best"}',
  timezone      text default 'America/Los_Angeles',
  onboarded     boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ════════════════════════════════════════════════════
-- CAMPAIGNS
-- ════════════════════════════════════════════════════

create type campaign_status as enum ('draft', 'active', 'paused', 'completed', 'archived');

create table public.campaigns (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  name            text not null,
  description     text,
  status          campaign_status default 'draft',
  icp_criteria    jsonb,
  sequence_config jsonb default '{"steps": 3, "delay_days": [0, 3, 7], "channels": ["email"]}',
  stats           jsonb default '{"total_leads": 0, "researched": 0, "drafted": 0, "sent": 0, "replied": 0, "booked": 0}',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ════════════════════════════════════════════════════
-- LEADS
-- ════════════════════════════════════════════════════

create type lead_status as enum (
  'new', 'researching', 'researched', 'drafting', 'draft_ready',
  'pending_approval', 'approved', 'sent', 'replied', 'qualified',
  'meeting_booked', 'not_interested', 'bounced', 'archived'
);

create table public.leads (
  id               uuid default uuid_generate_v4() primary key,
  campaign_id      uuid references public.campaigns(id) on delete cascade not null,
  user_id          uuid references public.profiles(id) on delete cascade not null,
  first_name       text not null,
  last_name        text not null,
  email            text,
  linkedin_url     text,
  title            text,
  company          text,
  company_url      text,
  research_data    jsonb,
  enrichment_score integer,
  status           lead_status default 'new',
  last_contacted_at timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index idx_leads_campaign on public.leads(campaign_id);
create index idx_leads_status   on public.leads(status);
create index idx_leads_user     on public.leads(user_id);

-- ════════════════════════════════════════════════════
-- INTERACTIONS (every message sent or received)
-- ════════════════════════════════════════════════════

create type interaction_type   as enum ('email_outbound', 'email_reply', 'linkedin_message', 'linkedin_reply', 'calendar_invite', 'internal_note');
create type interaction_status as enum ('draft', 'pending_approval', 'approved', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed');

create table public.interactions (
  id            uuid default uuid_generate_v4() primary key,
  lead_id       uuid references public.leads(id) on delete cascade not null,
  campaign_id   uuid references public.campaigns(id) on delete cascade not null,
  user_id       uuid references public.profiles(id) on delete cascade not null,
  type          interaction_type not null,
  status        interaction_status default 'draft',
  sequence_step integer default 1,
  subject       text,
  body          text not null,
  metadata      jsonb,
  sent_at       timestamptz,
  opened_at     timestamptz,
  replied_at    timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_interactions_lead   on public.interactions(lead_id);
create index idx_interactions_status on public.interactions(status);

-- ════════════════════════════════════════════════════
-- APPROVAL QUEUE (human-in-the-loop)
-- ════════════════════════════════════════════════════

create type approval_status as enum ('pending', 'approved', 'rejected', 'expired');

create table public.approvals (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  interaction_id  uuid references public.interactions(id) on delete cascade not null,
  lead_id         uuid references public.leads(id) on delete cascade not null,
  campaign_id     uuid references public.campaigns(id) on delete cascade not null,
  status          approval_status default 'pending',
  preview_subject text,
  preview_body    text not null,
  channel         text not null,
  agent_notes     text,
  reviewed_at     timestamptz,
  expires_at      timestamptz default (now() + interval '48 hours'),
  created_at      timestamptz default now()
);

create index idx_approvals_user_status on public.approvals(user_id, status);

-- ════════════════════════════════════════════════════
-- AGENT MEMORY (pgvector for campaign learning)
-- ════════════════════════════════════════════════════

create table public.memory (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  content     text not null,
  embedding   vector(1536),
  memory_type text not null,
  metadata    jsonb,
  created_at  timestamptz default now()
);

create index idx_memory_embedding on public.memory
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_memory_user on public.memory(user_id);

-- ════════════════════════════════════════════════════
-- AUDIT LOG (compliance + debugging)
-- ════════════════════════════════════════════════════

create table public.audit_log (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references public.profiles(id) on delete set null,
  action        text not null,
  resource_type text,
  resource_id   uuid,
  details       jsonb,
  ip_address    inet,
  created_at    timestamptz default now()
);

create index idx_audit_user    on public.audit_log(user_id);
create index idx_audit_action  on public.audit_log(action);
create index idx_audit_created on public.audit_log(created_at);

-- ════════════════════════════════════════════════════
-- AGENT RUNS (LangGraph execution tracking)
-- ════════════════════════════════════════════════════

create type agent_run_status as enum ('running', 'waiting_approval', 'completed', 'failed', 'cancelled');

create table public.agent_runs (
  id             uuid default uuid_generate_v4() primary key,
  user_id        uuid references public.profiles(id) on delete cascade not null,
  campaign_id    uuid references public.campaigns(id) on delete set null,
  thread_id      text not null,
  status         agent_run_status default 'running',
  current_node   text,
  state_snapshot jsonb,
  error_message  text,
  started_at     timestamptz default now(),
  completed_at   timestamptz,
  updated_at     timestamptz default now()
);

create index idx_agent_runs_thread on public.agent_runs(thread_id);

-- ════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════

alter table public.profiles     enable row level security;
alter table public.campaigns    enable row level security;
alter table public.leads        enable row level security;
alter table public.interactions enable row level security;
alter table public.approvals    enable row level security;
alter table public.memory       enable row level security;
alter table public.audit_log    enable row level security;
alter table public.agent_runs   enable row level security;

create policy "Own profile"     on public.profiles     for all using (auth.uid() = id);
create policy "Own campaigns"   on public.campaigns    for all using (auth.uid() = user_id);
create policy "Own leads"       on public.leads        for all using (auth.uid() = user_id);
create policy "Own interactions" on public.interactions for all using (auth.uid() = user_id);
create policy "Own approvals"   on public.approvals    for all using (auth.uid() = user_id);
create policy "Own memory"      on public.memory       for all using (auth.uid() = user_id);
create policy "View own audit"  on public.audit_log    for select using (auth.uid() = user_id);
create policy "Own agent runs"  on public.agent_runs   for all using (auth.uid() = user_id);

-- ════════════════════════════════════════════════════
-- TRIGGERS & FUNCTIONS
-- ════════════════════════════════════════════════════

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto-update updated_at
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated     before update on public.profiles     for each row execute procedure public.update_updated_at();
create trigger trg_campaigns_updated    before update on public.campaigns    for each row execute procedure public.update_updated_at();
create trigger trg_leads_updated        before update on public.leads        for each row execute procedure public.update_updated_at();
create trigger trg_interactions_updated before update on public.interactions for each row execute procedure public.update_updated_at();
create trigger trg_agent_runs_updated   before update on public.agent_runs   for each row execute procedure public.update_updated_at();

-- Similarity search over memory embeddings
create or replace function public.search_memories(
  query_embedding vector(1536),
  match_user_id   uuid,
  match_count     int   default 5,
  match_threshold float default 0.7
)
returns table (
  id          uuid,
  content     text,
  memory_type text,
  metadata    jsonb,
  similarity  float
)
language plpgsql as $$
begin
  return query
  select
    m.id,
    m.content,
    m.memory_type,
    m.metadata,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.memory m
  where m.user_id = match_user_id
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
end;
$$;
