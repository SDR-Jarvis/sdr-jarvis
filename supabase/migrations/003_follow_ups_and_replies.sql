-- SDR Jarvis — Follow-ups & Reply Detection
-- Run in Supabase SQL Editor after 001 and 002

-- Composite index for the follow-up cron query:
-- find leads with status='sent' ordered by last_contacted_at
create index if not exists idx_leads_status_contacted
  on public.leads(status, last_contacted_at);

-- Index to quickly find interactions by message ID (for Resend webhook matching)
create index if not exists idx_interactions_metadata_message_id
  on public.interactions using gin (metadata);

-- Index for finding the latest interaction per lead+campaign
create index if not exists idx_interactions_lead_campaign
  on public.interactions(lead_id, campaign_id, sequence_step);
