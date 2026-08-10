-- ============================================================
-- Migration 041: история переписки amoCRM-каналов (WhatsApp и т.п.)
--
-- Наш сервер — мастер истории: каждое сообщение из вебхука amoCRM
-- (message[add]) и каждый ответ бота сохраняются здесь. По этой истории
-- строится контекст для ИИ-ответа (src/lib/amocrm/bot-reply.ts).
-- UNIQUE(amo_message_id) — идемпотентность: ретрай вебхука не создаёт
-- дубль и не заставляет бота ответить дважды.
-- ============================================================

CREATE TABLE public.amocrm_messages (
  id BIGSERIAL PRIMARY KEY,
  amo_message_id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  lead_id TEXT,
  contact_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender TEXT NOT NULL CHECK (sender IN ('client', 'bot', 'operator')),
  author_name TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX amocrm_messages_chat_idx ON public.amocrm_messages(chat_id, id);

ALTER TABLE public.amocrm_messages ENABLE ROW LEVEL SECURITY;

-- Пишет только сервер (service_role, вебхук); сотрудники читают.
CREATE POLICY "amocrm_messages_select" ON public.amocrm_messages
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON public.amocrm_messages TO authenticated;
GRANT ALL ON public.amocrm_messages TO service_role;
GRANT USAGE ON SEQUENCE public.amocrm_messages_id_seq TO service_role;
