ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS address VARCHAR(500);

COMMENT ON COLUMN public.deals.city IS 'Город клиента или доставки';
COMMENT ON COLUMN public.deals.address IS 'Адрес доставки клиента';

UPDATE public.deals AS deal
SET city = (
  SELECT orders.city
  FROM public.orders
  WHERE orders.deal_id = deal.id
    AND orders.city IS NOT NULL
  ORDER BY orders.created_at DESC
  LIMIT 1
)
WHERE deal.city IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.orders
    WHERE orders.deal_id = deal.id
      AND orders.city IS NOT NULL
  );
