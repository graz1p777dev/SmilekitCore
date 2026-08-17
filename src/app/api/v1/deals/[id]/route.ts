// Одна сделка: чтение, правка, удаление.
//
// GET    /api/v1/deals/<id>
// PATCH  /api/v1/deals/<id>   { stage_id?, amount?, note?, ... }
// DELETE /api/v1/deals/<id>   — мягкое удаление (deleted_at)

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, apiOk, guard, readJson, requireApiToken } from '@/lib/api/auth'

type Params = { params: Promise<{ id: string }> }

/** Поля, которые API разрешает менять. Всё остальное игнорируется молча
 *  нельзя: незнакомое поле — это чаще всего опечатка в интеграции. */
const EDITABLE = new Set([
  'title',
  'stage_id',
  'amount',
  'currency',
  'customer_name',
  'customer_phone',
  'customer_username',
  'city',
  'address',
  'responsible_employee_id',
  'note',
  'status',
])

export async function GET(request: NextRequest, { params }: Params) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const { id } = await params
    const { data, error } = await createAdminClient()
      .from('deals')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) return apiError(error.message, 500)
    if (!data) return apiError('Сделка не найдена', 404)
    return apiOk(data)
  })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const { id } = await params
    const body = await readJson(request)
    if (!body.ok) return body.response

    const unknown = Object.keys(body.data).filter((key) => !EDITABLE.has(key))
    if (unknown.length) return apiError(`Нельзя менять поля: ${unknown.join(', ')}`, 400)
    if (!Object.keys(body.data).length) return apiError('Пустое тело запроса', 400)

    const patch: Record<string, unknown> = { ...body.data, updated_at: new Date().toISOString() }
    // Смена этапа — это событие воронки: сбрасываем отсчёт времени в этапе,
    // иначе карточка будет показывать «в этапе 3 дня» сразу после переноса.
    if ('stage_id' in body.data) patch.stage_changed_at = new Date().toISOString()

    const { data, error } = await createAdminClient()
      .from('deals')
      .update(patch)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()

    if (error) return apiError(error.message, 400)
    if (!data) return apiError('Сделка не найдена', 404)
    return apiOk(data)
  })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const { id } = await params
    // Мягкое удаление — как во всей CRM: запись остаётся для отчётов.
    const { data, error } = await createAdminClient()
      .from('deals')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    if (error) return apiError(error.message, 400)
    if (!data) return apiError('Сделка не найдена', 404)
    return apiOk({ deleted: true, id })
  })
}
