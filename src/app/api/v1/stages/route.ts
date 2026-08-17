// Этапы воронки — справочник для интеграций: чтобы поставить сделке
// нужный stage_id, его сначала надо откуда-то взять.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, apiOk, guard, requireApiToken } from '@/lib/api/auth'

export async function GET(request: NextRequest) {
  return guard(async () => {
    const denied = await requireApiToken(request)
    if (denied) return denied

    const { data, error } = await createAdminClient()
      .from('deal_stages')
      .select('id, name, sort_order, kind, color, is_default, description')
      .order('sort_order')

    if (error) return apiError(error.message, 500)
    return apiOk({ items: data ?? [] })
  })
}
