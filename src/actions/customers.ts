'use server'

// Карточка клиента: всё, что система знает о человеке, в одном месте.
//
// Клиент определяется телефоном. Сделки и заказы собираются по последним
// 9 цифрам номера — форматы в базе разные ('+996 502 …' и '996502…'),
// точное равенство теряло половину истории (та же логика, что в
// crm.resolveDealKeyByPhone).

import { createClient } from '@/lib/supabase/server'
import type { Deal, Order } from '@/types'

export type CustomerActionResult = { success: true } | { success: false; error: string }

function digits(value: string): string {
  return value.replace(/\D/g, '')
}

async function requireSession() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session ? supabase : null
}

export interface CustomerProfile {
  phone: string
  name: string | null
  note: string | null
  tags: string[]
}

export interface CustomerCard {
  profile: CustomerProfile
  deals: Deal[]
  orders: Order[]
  /** Итого оплачено по заказам, по валютам. */
  totals: { currency: string; amount: number }[]
}

export async function getCustomerCard(rawPhone: string): Promise<CustomerCard | null> {
  const supabase = await requireSession()
  if (!supabase) return null

  const phone = digits(rawPhone)
  if (phone.length < 6) return null
  const suffix = phone.slice(-9)

  const [profileResult, dealsResult, ordersResult] = await Promise.all([
    supabase.from('customers').select('phone, name, note, tags').eq('phone', phone).maybeSingle(),
    supabase.from('deals').select('*').ilike('customer_phone', `%${suffix}`).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
    supabase.from('orders').select('*').ilike('customer_phone', `%${suffix}`).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
  ])

  // ilike по суффиксу может зацепить чужой номер с тем же хвостом в другом
  // коде страны — досверяем в коде, как везде.
  const matches = (value: string | null) => {
    const row = digits(String(value ?? ''))
    return row.endsWith(phone) || phone.endsWith(row)
  }
  const deals = ((dealsResult.data ?? []) as Deal[]).filter((deal) => matches(deal.customer_phone))
  const orders = ((ordersResult.data ?? []) as Order[]).filter((order) => matches(order.customer_phone))

  const totalsMap = new Map<string, number>()
  for (const order of orders) {
    if (order.total_amount === null || order.total_amount === undefined) continue
    const currency = order.currency ?? 'KGS'
    totalsMap.set(currency, (totalsMap.get(currency) ?? 0) + Number(order.total_amount))
  }

  const profile = profileResult.data as CustomerProfile | null
  const fallbackName = deals.find((deal) => deal.customer_name)?.customer_name ?? null

  return {
    profile: {
      phone,
      name: profile?.name ?? fallbackName,
      note: profile?.note ?? null,
      tags: profile?.tags ?? [],
    },
    deals,
    orders,
    totals: [...totalsMap.entries()].map(([currency, amount]) => ({ currency, amount })),
  }
}

export async function saveCustomerProfile(
  rawPhone: string,
  patch: { name?: string | null; note?: string | null; tags?: string[] }
): Promise<CustomerActionResult> {
  const supabase = await requireSession()
  if (!supabase) return { success: false, error: 'Нет авторизации' }

  const phone = digits(rawPhone)
  if (phone.length < 6) return { success: false, error: 'Некорректный номер' }

  const tags = (patch.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
  const { error } = await supabase.from('customers').upsert(
    {
      phone,
      name: patch.name?.trim() || null,
      note: patch.note?.trim() || null,
      tags,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone' }
  )
  if (error) return { success: false, error: error.message }
  return { success: true }
}
