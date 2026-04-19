-- Per-user sending domain preference for Email Domain settings UI (Resend setup is still env-level).

alter table public.profiles
  add column if not exists sending_domain text,
  add column if not exists wants_domain_buy_guide boolean not null default false;

comment on column public.profiles.sending_domain is 'Domain the user plans to verify in Resend (e.g. outreach.acme.com). UI only; FROM_EMAIL remains deployment-level until multi-tenant mail.';
comment on column public.profiles.wants_domain_buy_guide is 'User asked for full instructions including registering a new domain.';
