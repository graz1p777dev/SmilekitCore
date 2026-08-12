-- ============================================================
-- Ручное управление ботом по конкретному чату amoCRM.
--
-- Как только в чат вступает живой менеджер (сообщение sender='operator' в
-- amocrm_messages), бот перестаёт отвечать в этом чате навсегда — это
-- проверялось прямым EXISTS-запросом без возможности вернуть управление.
-- Владелец попросил тумблер «вернуть управление боту» — эта таблица
-- хранит ручной override и его время; логика сравнения с последним
-- сообщением менеджера — в src/lib/amocrm/bot-reply.ts (isManagerControllingChat).
-- ============================================================

CREATE TABLE public.amocrm_chat_control (
  chat_id TEXT PRIMARY KEY,
  bot_enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- employees.id того, кто щёлкнул тумблер — только для истории, без FK:
  -- employees.id ≠ auth.users.id (это id сотрудника, не сессии).
  updated_by UUID
);

ALTER TABLE public.amocrm_chat_control ENABLE ROW LEVEL SECURITY;

CREATE POLICY "amocrm_chat_control_select" ON public.amocrm_chat_control
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON public.amocrm_chat_control TO authenticated;
GRANT ALL ON public.amocrm_chat_control TO service_role;
