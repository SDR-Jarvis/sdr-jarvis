-- Compliance fields, admin flag, run accounting for daily caps

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

alter table public.profiles
  add column if not exists email_opt_out_footer text;

alter table public.profiles
  add column if not exists postal_address text;

alter table public.profiles
  add column if not exists warmup_daily_send_cap integer not null default 20;

comment on column public.profiles.email_opt_out_footer is 'Mandatory opt-out line appended to every outbound email body.';
comment on column public.profiles.postal_address is 'Physical mailing address for CAN-SPAM style compliance (recommended).';
comment on column public.profiles.warmup_daily_send_cap is 'Max approved sends per UTC day (deliverability guardrail).';

update public.profiles
set email_opt_out_footer = 'If this isn''t relevant, reply "no thanks" and I won''t follow up again.'
where email_opt_out_footer is null;

alter table public.profiles
  alter column email_opt_out_footer set default 'If this isn''t relevant, reply "no thanks" and I won''t follow up again.';

alter table public.profiles
  alter column email_opt_out_footer set not null;

alter table public.agent_runs
  add column if not exists leads_count integer not null default 0;
