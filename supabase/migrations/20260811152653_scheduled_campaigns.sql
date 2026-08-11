-- Запланированные промо-рассылки клиентам, которые не завершили покупку.
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'not_purchased',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_title_check CHECK (btrim(title) <> ''),
  CONSTRAINT campaigns_message_check CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  CONSTRAINT campaigns_audience_check CHECK (audience IN ('not_purchased')),
  CONSTRAINT campaigns_status_check CHECK (status IN ('scheduled','running','completed','cancelled','failed'))
);

CREATE TABLE public.campaign_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_key TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  lead_id TEXT,
  contact_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_recipients_channel_check CHECK (channel IN ('telegram','whatsapp','instagram')),
  CONSTRAINT campaign_recipients_status_check CHECK (status IN ('pending','sending','sent','failed','skipped')),
  CONSTRAINT campaign_recipients_unique_deal UNIQUE (campaign_id, deal_id)
);

CREATE INDEX campaigns_due_idx ON public.campaigns(scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX campaign_recipients_pending_idx ON public.campaign_recipients(campaign_id, id)
  WHERE status = 'pending';
CREATE INDEX campaign_recipients_deal_idx ON public.campaign_recipients(deal_id);

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_select" ON public.campaigns
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('owner','rop'));
CREATE POLICY "campaigns_insert" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('owner','rop'));
CREATE POLICY "campaigns_update" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('owner','rop'))
  WITH CHECK (public.get_my_role() IN ('owner','rop'));
CREATE POLICY "campaigns_delete" ON public.campaigns
  FOR DELETE TO authenticated
  USING (public.get_my_role() = 'owner');

CREATE POLICY "campaign_recipients_select" ON public.campaign_recipients
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('owner','rop')
    AND EXISTS (
      SELECT 1 FROM public.campaigns c WHERE c.id = campaign_id
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT SELECT ON public.campaign_recipients TO authenticated;
GRANT ALL ON public.campaigns, public.campaign_recipients TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.campaign_recipients_id_seq TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.campaigns;
