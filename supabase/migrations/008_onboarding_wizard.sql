alter table public.profiles
  add column if not exists product_description text,
  add column if not exists preview_leads jsonb,
  add column if not exists from_email text;

update public.profiles
set onboarded = true
where onboarded is null
  and created_at < now() - interval '1 hour';
