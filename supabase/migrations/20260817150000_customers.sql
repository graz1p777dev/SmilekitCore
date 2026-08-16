-- ============================================================
-- Карточка клиента.
--
-- Клиент в системе определяется телефоном (это единственный стабильный
-- идентификатор: сделки, заказы и переписка WhatsApp сходятся по номеру).
-- Таблица хранит то, чего нет в сделках: заметку о человеке и теги.
-- Строка заводится лениво — при первом сохранении заметки, а не на
-- каждого клиента заранее.
--
-- phone — только цифры (нормализуется в коде), PK защищает от дублей.
-- ============================================================

CREATE TABLE public.customers (
  phone       VARCHAR(32) PRIMARY KEY,
  name        TEXT,
  note        TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Карточку клиента видят и правят те же роли, что работают со сделками:
-- это рабочий инструмент менеджера, а не настройка системы.
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (TRUE);

GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
