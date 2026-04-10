-- SDR Jarvis — Subscriptions & Billing
-- Run via: supabase db push

-- ════════════════════════════════════════════════════
-- SUBSCRIPTIONS
-- ════════════════════════════════════════════════════

create type subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'
);

create table public.subscriptions (
  id                  uuid default uuid_generate_v4() primary key,
  user_id             uuid references public.profiles(id) on delete cascade not null unique,
  stripe_customer_id  text unique,
  stripe_subscription_id text unique,
  plan                text not null default 'free',
  status              subscription_status default 'trialing',
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean default false,
  leads_used_this_period integer default 0,
  emails_sent_this_period integer default 0,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_subscriptions_user on public.subscriptions(user_id);
create index idx_subscriptions_stripe on public.subscriptions(stripe_customer_id);

alter table public.subscriptions enable row level security;
create policy "Own subscription" on public.subscriptions for all using (auth.uid() = user_id);

create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute procedure public.update_updated_at();

-- Auto-create free subscription on profile creation
create or replace function public.handle_new_subscription()
returns trigger as $$
begin
  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_profile_created_subscription
  after insert on public.profiles
  for each row execute procedure public.handle_new_subscription();
