-- ============================================================
-- bot_messages: канало-независимая история переписки ИИ-бота.
--
-- Готовим переход WhatsApp-канала с amoCRM/WhatCRM на Green API —
-- новые сообщения (provider='greenapi') пишутся сюда напрямую, без
-- привязки к amoCRM. amocrm_messages остаётся источником для живого
-- amoCRM-канала до его отключения; ниже — разовый бэкфилл истории
-- оттуда для непрерывности контекста ИИ по номеру телефона (один и
-- тот же клиент, если раньше писал через amoCRM, а теперь пишет через
-- Green API на тот же номер, не должен «терять» историю).
--
-- chat_id = нормализованный номер телефона (только цифры) для обоих
-- провайдеров — это единственный стабильный идентификатор клиента в
-- WhatsApp, не зависящий от provider.
-- ============================================================

CREATE TABLE public.bot_messages (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('amocrm', 'greenapi')),
  provider_message_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  lead_id TEXT,
  contact_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender TEXT NOT NULL CHECK (sender IN ('client', 'bot', 'operator')),
  author_name TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_message_id)
);

CREATE INDEX bot_messages_chat_idx ON public.bot_messages(chat_id, id);

ALTER TABLE public.bot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bot_messages_select" ON public.bot_messages
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON public.bot_messages TO authenticated;
GRANT ALL ON public.bot_messages TO service_role;
GRANT USAGE ON SEQUENCE public.bot_messages_id_seq TO service_role;

-- Разовый бэкфилл: amocrm_messages -> bot_messages, chat_id заменён на
-- телефон клиента (через deals.external_key = 'amocrm:'||lead_id).
-- Сообщения без опознанного lead_id/телефона пропускаем — без номера
-- их всё равно не с чем сопоставить в Green API.
INSERT INTO public.bot_messages
  (provider, provider_message_id, chat_id, lead_id, contact_id, direction, sender, author_name, text, created_at)
SELECT
  'amocrm',
  m.amo_message_id,
  regexp_replace(d.customer_phone, '\D', '', 'g'),
  m.lead_id,
  m.contact_id,
  m.direction,
  m.sender,
  m.author_name,
  m.text,
  m.created_at
FROM public.amocrm_messages m
JOIN public.deals d ON d.external_key = 'amocrm:' || m.lead_id
WHERE m.lead_id IS NOT NULL
  AND d.customer_phone IS NOT NULL
  AND regexp_replace(d.customer_phone, '\D', '', 'g') <> ''
ON CONFLICT (provider, provider_message_id) DO NOTHING;
