// Карточка клиента по телефону: профиль + его сделки и заказы.
//
// GET   /api/v1/customers/996500111222
// PATCH /api/v1/customers/996500111222   { name?, note?, tags? }
//
// Клиент определяется телефоном — это единственный стабильный
// идентификатор человека во всех каналах.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, apiOk, guard, readJson, requireApiToken } from '@/lib/api/auth'

type Params = { params: Promise<{ phone: string }> }

function digits(value: string): string {
  return value.replace(/\D/g, '')
}

export async function GET(request: NextRequest, { params }: Params) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const phone = digits((await params).phone)
    if (phone.length < 6) return apiError('Некорректный номер', 400)
    const suffix = phone.slice(-9)

    const supabase = createAdminClient()
    const [profile, deals, orders] = await Promise.all([
      supabase.from('customers').select('phone, name, note, tags').eq('phone', phone).maybeSingle(),
      supabase.from('deals').select('*').ilike('customer_phone', `%${suffix}`).is('deleted_at', null),
      supabase.from('orders').select('*').ilike('customer_phone', `%${suffix}`).is('deleted_at', null),
    ])

    // ilike по суффиксу может зацепить чужой номер с тем же хвостом в другом
    // коде страны — досверяем точно.
    const matches = (value: unknown) => {
      const row = digits(String(value ?? ''))
      return row.endsWith(phone) || phone.endsWith(row)
    }

    return apiOk({
      phone,
      profile: profile.data ?? null,
      deals: (deals.data ?? []).filter((row) => matches((row as { customer_phone: string }).customer_phone)),
      orders: (orders.data ?? []).filter((row) => matches((row as { customer_phone: string }).customer_phone)),
    })
  })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const phone = digits((await params).phone)
    if (phone.length < 6) return apiError('Некорректный номер', 400)

    const body = await readJson(request)
    if (!body.ok) return body.response

    const tags = Array.isArray(body.data.tags)
      ? (body.data.tags as unknown[]).map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20)
      : undefined

    const { data, error } = await createAdminClient()
      .from('customers')
      .upsert(
        {
          phone,
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          ...(body.data.note !== undefined ? { note: body.data.note } : {}),
          ...(tags !== undefined ? { tags } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone' }
      )
      .select('phone, name, note, tags')
      .maybeSingle()

    if (error) return apiError(error.message, 400)
    return apiOk(data)
  })
}
