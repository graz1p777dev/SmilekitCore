-- Номера, которым рассылки отправлять нельзя никогда (жалобы, личная
-- договорённость и т.п.) — независимо от того, купили они или нет.
-- Телефон хранится нормализованным (только цифры) — сравнение в
-- eligibleRecipients() приводит deals.customer_phone к тому же виду.
CREATE TABLE public.campaign_opt_outs (
  phone TEXT PRIMARY KEY,
  reason TEXT,
  created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_opt_outs_phone_check CHECK (phone ~ '^[0-9]{5,20}$')
);

ALTER TABLE public.campaign_opt_outs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_opt_outs_select" ON public.campaign_opt_outs
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('owner','rop'));
CREATE POLICY "campaign_opt_outs_insert" ON public.campaign_opt_outs
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('owner','rop'));
CREATE POLICY "campaign_opt_outs_delete" ON public.campaign_opt_outs
  FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('owner','rop'));

GRANT SELECT, INSERT, DELETE ON public.campaign_opt_outs TO authenticated;
GRANT ALL ON public.campaign_opt_outs TO service_role;
