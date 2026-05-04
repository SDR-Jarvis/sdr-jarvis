-- Match Resend webhook `email_id` to outbound rows reliably (in addition to metadata.messageId JSON).

ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS resend_email_id text;

CREATE INDEX IF NOT EXISTS idx_interactions_resend_email_id
  ON public.interactions (resend_email_id)
  WHERE resend_email_id IS NOT NULL;

COMMENT ON COLUMN public.interactions.resend_email_id IS 'Resend send API id (data.id) for outbound email; used by webhooks for open/deliver/bounce.';
