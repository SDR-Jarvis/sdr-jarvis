-- SDR Jarvis — Founder upgrades (YC metrics, sending mode, ICP cache, feedback loop)

-- ── profiles: sending + metrics + OAuth display + banner ───────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sending_mode text DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS first_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS apollo_api_key text,
  ADD COLUMN IF NOT EXISTS domain_banner_dismissed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_sending_mode_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_sending_mode_check
  CHECK (sending_mode IS NULL OR sending_mode IN ('shared', 'custom'));

COMMENT ON COLUMN public.profiles.sending_mode IS 'shared = FROM_EMAIL env; custom = user sending_domain when verified in Resend.';
COMMENT ON COLUMN public.profiles.first_email_sent_at IS 'First successful outbound send — time-to-first-send metric.';
COMMENT ON COLUMN public.profiles.domain_banner_dismissed IS 'User dismissed shared-sender upsell banner on campaign run.';

-- campaigns: ICP copy per campaign (profiles.icp_description already exists)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS icp_description text;

-- ── icp_discovery_cache ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.icp_discovery_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  icp_hash text NOT NULL,
  icp_description text NOT NULL,
  leads jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_stats jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (user_id, icp_hash)
);

ALTER TABLE public.icp_discovery_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_cache" ON public.icp_discovery_cache;
CREATE POLICY "users_own_cache" ON public.icp_discovery_cache
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_icp_cache_user_hash ON public.icp_discovery_cache(user_id, icp_hash);
CREATE INDEX IF NOT EXISTS idx_icp_cache_expires ON public.icp_discovery_cache(expires_at);

-- ── leads: ICP scoring / discovery provenance ───────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS icp_score integer,
  ADD COLUMN IF NOT EXISTS icp_label text,
  ADD COLUMN IF NOT EXISTS icp_match_reason text,
  ADD COLUMN IF NOT EXISTS discovery_source text,
  ADD COLUMN IF NOT EXISTS enrichment_data jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_leads_icp_label ON public.leads(icp_label);

-- ── interactions: feedback loop (AI vs human) ───────────────────────────
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS ai_draft_subject text,
  ADD COLUMN IF NOT EXISTS ai_draft_body text,
  ADD COLUMN IF NOT EXISTS human_approved_subject text,
  ADD COLUMN IF NOT EXISTS human_approved_body text,
  ADD COLUMN IF NOT EXISTS was_edited boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS edit_delta_chars integer DEFAULT 0;

-- ── discovery rate limits ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  run_count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.discovery_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_limits" ON public.discovery_rate_limits;
CREATE POLICY "users_own_limits" ON public.discovery_rate_limits
  FOR ALL USING (auth.uid() = user_id);

-- ── OAuth-friendly profile bootstrap ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    avatar_url,
    email
  )
  VALUES (
    new.id,
    COALESCE(
      NULLIF(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(trim(new.raw_user_meta_data ->> 'name'), ''),
      NULLIF(trim(new.raw_user_meta_data ->> 'given_name'), ''),
      split_part(new.email, '@', 1)
    ),
    NULLIF(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    new.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
