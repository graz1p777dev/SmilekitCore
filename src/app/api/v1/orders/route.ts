// Заказы: список и создание.
//
// GET  /api/v1/orders?limit=50&offset=0&status=new
// POST /api/v1/orders  { customer_phone, quantity, total_amount, ... }

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, apiOk, guard, readJson, readPaging, requireApiToken } from '@/lib/api/auth'

export async function GET(request: NextRequest) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const url = new URL(request.url)
    const { limit, offset } = readPaging(url)
    const status = url.searchParams.get('status')
    const phone = url.searchParams.get('phone')?.replace(/\D/g, '')

    let query = createAdminClient()
      .from('orders')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) query = query.eq('status', status)
    // Телефоны хранятся в разных форматах — ищем по последним 9 цифрам,
    // как и везде в CRM.
    if (phone && phone.length >= 6) query = query.ilike('customer_phone', `%${phone.slice(-9)}`)

    const { data, error, count } = await query
    if (error) return apiError(error.message, 500)

    return apiOk({ items: data ?? [], total: count ?? 0, limit, offset })
  })
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const body = await readJson(request)
    if (!body.ok) return body.response

    const { data, error } = await createAdminClient()
      .from('orders')
      .insert({
        customer_name: body.data.customer_name ?? null,
        customer_phone: body.data.customer_phone ?? null,
        customer_username: body.data.customer_username ?? null,
        quantity: body.data.quantity ?? null,
        unit_price: body.data.unit_price ?? null,
        total_amount: body.data.total_amount ?? null,
        currency: body.data.currency ?? 'KGS',
        city: body.data.city ?? null,
        status: body.data.status ?? 'new',
        source: body.data.source ?? 'manual',
        summary: body.data.summary ?? null,
        note: body.data.note ?? null,
        external_key: body.data.external_key ?? null,
        deal_id: body.data.deal_id ?? null,
      })
      .select('*')
      .single()

    if (error) return apiError(error.message, 400)
    return apiOk(data, 201)
  })
}
