-- ============================================================
-- Конструктор сценариев: шаблоны, переменные и защита от дублей.
--
-- flow_templates — именованные тексты. Ветка ссылается на шаблон, а не
--   хранит копию текста: поправили формулировку один раз — изменилось
--   везде, где шаблон подставлен.
--
-- flow_variables — подстановки вида {{имя}} в текстах. Источник значения
--   выбирается из списка: дата, время, имя/телефон клиента, его сообщение,
--   фиксированный текст — или ИИ, который заполняет переменную по своему
--   промпту (например «вытащи из переписки город клиента»).
--
-- flow_rules.dedupe — защита от повторов: ветка может срабатывать один раз
--   на чат или не чаще, чем раз в N минут. Клиент, написавший «сколько
--   стоит» трижды подряд, не должен трижды получить один и тот же ответ.
-- ============================================================

CREATE TABLE public.flow_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  text        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.flow_templates ENABLE ROW LEVEL SECURITY;

-- Тексты, которыми бот говорит с клиентами, — тот же уровень доступа, что
-- у веток сценария: только владелец.
CREATE POLICY "flow_templates_select_owner" ON public.flow_templates
  FOR SELECT TO authenticated USING (public.get_my_role() = 'owner');

GRANT SELECT ON public.flow_templates TO authenticated;
GRANT ALL ON public.flow_templates TO service_role;

CREATE TABLE public.flow_variables (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Имя подстановки: {{город}}. Уникально — иначе непонятно, какая победит.
  name        TEXT        NOT NULL UNIQUE,
  source      TEXT        NOT NULL DEFAULT 'static'
              CHECK (source IN ('date', 'time', 'datetime', 'client_name',
                                'client_phone', 'message', 'static', 'ai')),
  -- Промпт для source = 'ai': что именно модель должна положить в переменную.
  ai_prompt   TEXT,
  -- Значение для source = 'static'.
  value       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.flow_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flow_variables_select_owner" ON public.flow_variables
  FOR SELECT TO authenticated USING (public.get_my_role() = 'owner');

GRANT SELECT ON public.flow_variables TO authenticated;
GRANT ALL ON public.flow_variables TO service_role;

-- Защита от дублей: {"mode":"off"} | {"mode":"once_per_chat"} |
-- {"mode":"cooldown","minutes":60}
ALTER TABLE public.flow_rules
  ADD COLUMN IF NOT EXISTS dedupe JSONB NOT NULL DEFAULT '{"mode":"off"}'::jsonb;
