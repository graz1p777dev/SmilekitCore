// Сделки: список и создание.
//
// GET  /api/v1/deals?limit=50&offset=0&stage_id=…&search=…
// POST /api/v1/deals   { title, customer_phone, ... }

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, apiOk, guard, readJson, readPaging, requireApiToken } from '@/lib/api/auth'

export async function GET(request: NextRequest) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const url = new URL(request.url)
    const { limit, offset } = readPaging(url)
    const stageId = url.searchParams.get('stage_id')
    const search = url.searchParams.get('search')?.trim()

    let query = createAdminClient()
      .from('deals')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (stageId) query = query.eq('stage_id', stageId)
    if (search) {
      query = query.or(
        `title.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`
      )
    }

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

    const title = String(body.data.title ?? '').trim()
    if (!title) return apiError('Поле title обязательно', 400)

    const supabase = createAdminClient()

    // Этап: если не указан — берём этап по умолчанию, иначе сделка повиснет
    // вне воронки и её никто не увидит.
    let stageId = body.data.stage_id ? String(body.data.stage_id) : null
    if (!stageId) {
      const { data: stage } = await supabase
        .from('deal_stages')
        .select('id')
        .eq('is_default', true)
        .maybeSingle()
      stageId = (stage as { id?: string } | null)?.id ?? null
      if (!stageId) return apiError('Не задан stage_id, а этап по умолчанию не найден', 400)
    }

    const { data, error } = await supabase
      .from('deals')
      .insert({
        title,
        stage_id: stageId,
        amount: body.data.amount ?? null,
        currency: body.data.currency ?? 'KGS',
        customer_name: body.data.customer_name ?? null,
        customer_phone: body.data.customer_phone ?? null,
        customer_username: body.data.customer_username ?? null,
        city: body.data.city ?? null,
        address: body.data.address ?? null,
        source: body.data.source ?? 'manual',
        external_key: body.data.external_key ?? null,
        note: body.data.note ?? null,
      })
      .select('*')
      .single()

    if (error) return apiError(error.message, 400)
    return apiOk(data, 201)
  })
}
