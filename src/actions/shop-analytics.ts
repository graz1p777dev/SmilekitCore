'use server'

// Аналитика витрины: просмотры карточек товаров и клики «Купить».
// Источник — GET /api/admin/crm/analytics витрины (buy_clicks + product_views).

import { shopFetch } from '@/lib/shop-api'
import { SHOP_ANALYTICS_PERIODS, type ShopAnalytics } from '@/lib/models/shop'

export async function getShopAnalytics(
  days = 30
): Promise<{ ok: true; data: ShopAnalytics } | { ok: false; error: string }> {
  const period = (SHOP_ANALYTICS_PERIODS as readonly number[]).includes(days) ? days : 30
  const result = await shopFetch<ShopAnalytics>(`/crm/analytics?days=${period}`)
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, data: result.data }
}
