import { NextRequest, NextResponse } from 'next/server'
import { upsertDealFromInbound } from '@/lib/deals/auto-create'

// Вебхук amoCRM (канал "Боты" в настройках интеграций). Секрет в query
// string — единственная проверка, что запрос реально от amoCRM (сам amoCRM
// ничего не подписывает по умолчанию), тот же паттерн, что и /api/whatsapp/webhook.
//
// ВНИМАНИЕ: маппинг полей пока не подтверждён реальным пейлоадом — первый
// запрос от amoCRM просто логируется целиком, чтобы увидеть точный формат
// (form-urlencoded у amoCRM обычно приходит как leads[add][0][...]),
// затем маппинг будет дописан по факту.

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.AMOCRM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''
  const raw = await request.text()

  let parsed: unknown = raw
  if (contentType.includes('application/json')) {
    parsed = JSON.parse(raw)
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    parsed = Object.fromEntries(new URLSearchParams(raw))
  }

  console.log('amocrm webhook payload', JSON.stringify({ contentType, parsed }))

  const leadId = extractLeadId(parsed)
  if (leadId) {
    const result = await upsertDealFromInbound({
      externalKey: `amocrm:${leadId}`,
      source: 'amocrm',
    })
    if (result.error) console.error('amocrm webhook deal upsert failed', leadId, result.error)
  }

  return NextResponse.json({ ok: true })
}

function extractLeadId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const candidate = record['leads[add][0][id]'] ?? record['leads[status][0][id]']
  return typeof candidate === 'string' ? candidate : null
}
