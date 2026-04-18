-- Per-campaign daily lead refresh (cron) + lead assignment timestamp

alter table public.campaigns
  add column if not exists daily_lead_cap integer not null default 20;

alter table public.campaigns
  add column if not exists is_lead_pool boolean not null default false;

comment on column public.campaigns.daily_lead_cap is 'Max leads assignable to this campaign per UTC day (daily refresh cron).';
comment on column public.campaigns.is_lead_pool is 'When true, leads in this campaign are a pool the daily refresh can pull from into active campaigns.';

alter table public.leads
  add column if not exists assigned_at timestamptz default now();

update public.leads
set assigned_at = coalesce(assigned_at, created_at)
where assigned_at is null;
