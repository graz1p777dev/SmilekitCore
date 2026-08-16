-- ============================================================
-- Настройка интеграций и сценариев из браузера, без правки кода.
--
-- Три таблицы:
--   integration_variables — переменные и секреты (то, что раньше жило
--     только в переменных окружения Railway). Секреты хранятся
--     зашифрованными AES-256-GCM (ключ INTEGRATION_ENCRYPTION_KEY,
--     единственный секрет, который остаётся в панели хостинга).
--   flow_rules — сценарий «если клиент написал X → сделать Y, подождать,
--     сделать Z». Порядок веток задаёт приоритет: первая совпавшая
--     выигрывает, как в скрипте продаж.
--   flow_jobs — отложенные шаги (действие «Подождать»): что доделать и
--     когда. Планировщик раз в 30 секунд забирает созревшие.
--
-- Значения секретов НЕ доступны роли authenticated ни при каких
-- условиях — только service_role. Страница настроек читает их через
-- серверные действия под проверкой роли владельца и показывает лишь
-- хвост значения.
-- ============================================================

CREATE TABLE public.integration_variables (
  name             TEXT        PRIMARY KEY,
  integration_id   TEXT,
  description      TEXT,
  is_secret        BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Открытое значение: адреса, лимиты, списки номеров.
  value            TEXT,
  -- base64(iv || tag || ciphertext) для is_secret = TRUE.
  value_encrypted  TEXT,
  -- Последние 4 символа секрета — чтобы владелец узнавал ключ в UI,
  -- не расшифровывая его.
  value_hint       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT integration_variables_value_present CHECK (
    (is_secret = TRUE  AND value IS NULL) OR
    (is_secret = FALSE AND value_encrypted IS NULL)
  )
);

CREATE INDEX integration_variables_integration_idx
  ON public.integration_variables(integration_id);

ALTER TABLE public.integration_variables ENABLE ROW LEVEL SECURITY;
-- Ни одной политики для authenticated: значения переменных не должны
-- утекать в браузер даже владельцу — он получает их через серверные
-- действия уже замаскированными.
GRANT ALL ON public.integration_variables TO service_role;

CREATE TABLE public.flow_rules (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     TEXT        NOT NULL DEFAULT 'greenapi',
  name        TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  position    INTEGER     NOT NULL DEFAULT 0,
  -- [{ field, op, value }] — все условия должны совпасть (И).
  conditions  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- [{ type, ...параметры }] — выполняются по порядку.
  actions     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Ветка сработала — не продолжать встроенный скрипт продаж.
  stop_after  BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Координаты узлов на канве: чисто оформление, на выполнение не влияет.
  layout      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX flow_rules_channel_idx ON public.flow_rules(channel, position);

ALTER TABLE public.flow_rules ENABLE ROW LEVEL SECURITY;

-- Только владелец: в ветках лежат адреса вебхуков (иногда с токеном в query)
-- и тексты, которыми бот говорит с клиентами. Это тот же уровень доступа,
-- что у таблицы integrations, а не «читают все сотрудники».
CREATE POLICY "flow_rules_select_owner" ON public.flow_rules
  FOR SELECT TO authenticated USING (public.get_my_role() = 'owner');

GRANT SELECT ON public.flow_rules TO authenticated;
GRANT ALL ON public.flow_rules TO service_role;

CREATE TABLE public.flow_jobs (
  id            BIGSERIAL   PRIMARY KEY,
  rule_id       UUID        REFERENCES public.flow_rules(id) ON DELETE CASCADE,
  channel       TEXT        NOT NULL,
  chat_id       TEXT        NOT NULL,
  -- С какого действия продолжить после паузы.
  resume_index  INTEGER     NOT NULL,
  run_at        TIMESTAMPTZ NOT NULL,
  -- Клиент ответил за время паузы — отложенный шаг отменяется.
  cancel_if_replied BOOLEAN NOT NULL DEFAULT TRUE,
  -- Контекст: ключ сделки, id входящего сообщения, текст клиента.
  state         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- running — шаг взят планировщиком в работу: страхует от повторного
  -- выполнения, если тик наложится на предыдущий.
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done', 'cancelled', 'failed')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX flow_jobs_pending_idx ON public.flow_jobs(run_at) WHERE status = 'pending';
CREATE INDEX flow_jobs_chat_idx ON public.flow_jobs(chat_id, status);

ALTER TABLE public.flow_jobs ENABLE ROW LEVEL SECURITY;

-- В state лежит текст клиента — те же ограничения, что у переписки.
CREATE POLICY "flow_jobs_select_owner" ON public.flow_jobs
  FOR SELECT TO authenticated USING (public.get_my_role() = 'owner');

GRANT SELECT ON public.flow_jobs TO authenticated;
GRANT ALL ON public.flow_jobs TO service_role;
GRANT USAGE ON SEQUENCE public.flow_jobs_id_seq TO service_role;
