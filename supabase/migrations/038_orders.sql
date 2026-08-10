-- ============================================================
-- Migration 038: orders (заказы из Telegram-бота)
--
-- Бот Smilekit доводит клиента до заказа сам. Как только заказ
-- действительно оформляется, бот шлёт его в CRM (POST /api/internal/orders),
-- менеджер видит уведомление и разбирает заказ на странице «Заказы».
--
-- Почему отдельная таблица, а не этап в deals:
--   deals — это ПУТЬ клиента (интерес → выявление потребности → дожим).
--   Один и тот же клиент проходит его один раз, сделка живёт долго.
--   orders — это ФАКТ: сколько коробок, куда везти, на какую сумму.
--   У одного клиента заказов может быть несколько, и их статус — про
--   исполнение (собрали → отправили → доставили), а не про продажу.
--   Смешивать это в одной таблице значит потерять либо историю воронки,
--   либо историю отгрузок.
--
-- Статусы — маленький набор, ровно линия исполнения:
--   new       — заказ пришёл от бота, менеджер ещё не связался
--   confirmed — менеджер подтвердил состав и адрес с клиентом
--   shipped   — передан в доставку
--   delivered — клиент получил
--   cancelled — терминальная отмена, достижима с любого шага
-- Больше статусов здесь не нужно: продажная воронка уже описана в
-- deal_stages, дублировать её этапами заказа нельзя — рассинхронизируется.
--
-- Неизвестные поля лежат NULL. Бот обязан вернуть null, если клиент не
-- назвал город/телефон/количество: выдуманный телефон менеджеру хуже пустого,
-- поэтому quantity/total_amount/city/контакты все nullable, а CHECK'и
-- проверяют только диапазон, если значение всё же есть.
-- ============================================================

CREATE TABLE public.orders (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Контакт клиента ровно в том виде, в каком его дал клиент.
  customer_name           VARCHAR(200),
  customer_phone          VARCHAR(32),
  customer_username       VARCHAR(120),
  telegram_chat_id        BIGINT,

  -- Состав. quantity — коробки (в коробке 14 полосок).
  quantity                INTEGER,
  unit_price              NUMERIC(12,2),
  total_amount            NUMERIC(12,2),
  currency                TEXT         NOT NULL DEFAULT 'KGS',

  city                    VARCHAR(120),

  status                  TEXT         NOT NULL DEFAULT 'new',
  source                  TEXT         NOT NULL DEFAULT 'telegram_bot',

  -- summary — текст заказа словами от бота (order_summary гипервизора).
  -- note — то, что дописал менеджер руками. Их нельзя смешивать: правка
  -- менеджера не должна затираться следующим сообщением клиента.
  summary                 TEXT,
  note                    TEXT,

  -- Ключ идемпотентности: telegram:<chat_id>:order:<отпечаток состава>.
  -- UNIQUE — повтор запроса от бота не создаёт второй заказ.
  external_key            TEXT         UNIQUE,

  -- Если по этому клиенту уже есть сделка — связываем. Сделку отсюда
  -- НЕ создаём: сделки заводит модуль deals по ключу диалога
  -- (deals.external_key = 'telegram:<chat_id>'), и дублировать эту логику
  -- значит получить две точки правды на один и тот же диалог.
  deal_id                 UUID         REFERENCES public.deals(id)     ON DELETE SET NULL,
  responsible_employee_id UUID         REFERENCES public.employees(id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,

  -- Валюты — те же три, что у сделок (036). Наличие есть в Кыргызстане,
  -- Казахстане и Узбекистане, но цена подтверждена только в сомах,
  -- поэтому выдумывать KZT/UZS в схеме нечем.
  CONSTRAINT orders_currency_check CHECK (currency IN ('KGS','USD','RUB')),
  CONSTRAINT orders_status_check   CHECK (status   IN ('new','confirmed','shipped','delivered','cancelled')),
  CONSTRAINT orders_source_check   CHECK (source   IN ('telegram_bot','manual')),
  CONSTRAINT orders_quantity_check CHECK (quantity     IS NULL OR (quantity > 0 AND quantity <= 1000)),
  CONSTRAINT orders_unit_check     CHECK (unit_price   IS NULL OR unit_price   >= 0),
  CONSTRAINT orders_total_check    CHECK (total_amount IS NULL OR total_amount >= 0)
);

CREATE INDEX idx_orders_status      ON public.orders(status);
CREATE INDEX idx_orders_created     ON public.orders(created_at DESC);
CREATE INDEX idx_orders_responsible ON public.orders(responsible_employee_id);
CREATE INDEX idx_orders_deal        ON public.orders(deal_id);
CREATE INDEX idx_orders_chat        ON public.orders(telegram_chat_id);
CREATE INDEX idx_orders_active      ON public.orders(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Видимость заказа. Правило то же, что у сделок (036): владелец и РОП
-- видят всё, менеджер — свои и ничьи (заказ от бота приходит без
-- ответственного, иначе его некому будет забрать). Бухгалтеру не нужно.
-- Отдельная функция, а не can_see_deal: правило совпадает сегодня, но
-- меняться будет по разным причинам.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_order(o_responsible UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    public.get_my_role() IN ('owner','rop')
    OR (
      public.get_my_role() IN ('mp','lmai')
      AND (o_responsible IS NULL OR o_responsible = public.get_my_employee_id())
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_see_order(UUID) TO authenticated;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select" ON public.orders
  FOR SELECT TO authenticated
  USING (public.can_see_order(responsible_employee_id));

CREATE POLICY "orders_insert" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('owner','rop','mp','lmai'));

CREATE POLICY "orders_update" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.can_see_order(responsible_employee_id))
  WITH CHECK (public.get_my_role() IN ('owner','rop','mp','lmai'));

-- Удаление мягкое (deleted_at через UPDATE); жёсткое — только владельцу.
CREATE POLICY "orders_delete" ON public.orders
  FOR DELETE TO authenticated
  USING (public.get_my_role() = 'owner');

-- GRANT'ы явно — см. пояснение в 035/036: default privileges на это
-- полагаться не позволяют, без GRANT authenticated упирается в 42501.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

-- ------------------------------------------------------------
-- Новый тип уведомления.
--
-- ЛОВУШКА: notifications.type — CHECK-константа (012, расширена в 031).
-- INSERT с типом вне списка падает 23514, а notify() глотает ошибку в
-- console.error — уведомление молча не появится. Поэтому список
-- расширяем здесь же, в одной миграции с таблицей.
-- ------------------------------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'kpi_alert','kpi_success','plan_100','absence',
    'salary_ready','finance_alert','system','sale',
    'consultation_booked','consultation_reminder','sale_lead',
    'server_load','deploy','security','audit',
    'order_new'
  )
);

-- Realtime — список заказов обновляется у всех, кто его открыл.
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
