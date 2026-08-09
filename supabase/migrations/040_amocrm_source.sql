-- ============================================================
-- Migration 040: 'amocrm' как разрешённый источник сделки
--
-- Подключаем приём вебхука от amoCRM (см. src/app/api/amocrm/webhook) —
-- без этого upsertDealFromInbound падал бы на CHECK-constraint.
-- ============================================================

ALTER TABLE public.deals DROP CONSTRAINT deals_source_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_source_check
  CHECK (source IN ('telegram','whatsapp','instagram','manual','site','amocrm'));
