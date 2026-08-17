// Один заказ: чтение, правка, удаление.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, apiOk, guard, readJson, requireApiToken } from '@/lib/api/auth'

type Params = { params: Promise<{ id: string }> }

const EDITABLE = new Set([
  'customer_name',
  'customer_phone',
  'customer_username',
  'quantity',
  'unit_price',
  'total_amount',
  'currency',
  'city',
  'status',
  'summary',
  'note',
  'deal_id',
  'responsible_employee_id',
])

export async function GET(request: NextRequest, { params }: Params) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const { id } = await params
    const { data, error } = await createAdminClient()
      .from('orders')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) return apiError(error.message, 500)
    if (!data) return apiError('Заказ не найден', 404)
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

    const { data, error } = await createAdminClient()
      .from('orders')
      .update({ ...body.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()

    if (error) return apiError(error.message, 400)
    if (!data) return apiError('Заказ не найден', 404)
    return apiOk(data)
  })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const { id } = await params
    const { data, error } = await createAdminClient()
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    if (error) return apiError(error.message, 400)
    if (!data) return apiError('Заказ не найден', 404)
    return apiOk({ deleted: true, id })
  })
}
