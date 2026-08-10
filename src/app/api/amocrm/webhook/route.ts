import { NextRequest, NextResponse } from 'next/server'
import { upsertDealFromInbound } from '@/lib/deals/auto-create'

// Вебхук amoCRM (Настройки → Интеграции → Webhooks на towhite.amocrm.ru).
// Секрет в query string — единственная проверка, что запрос от amoCRM (сам
// amoCRM ничего не подписывает), тот же паттерн, что и /api/whatsapp/webhook.
//
// amoCRM шлёт form-urlencoded с ключами вида leads[add][0][id]. По id лида
// добираем через API amoCRM имя лида и телефон контакта — сделка у нас
// заводится сразу с полными данными, наш сервер остаётся мастером истории.

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.AMOCRM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''
  const raw = await request.text()

  let parsed: Record<string, unknown> = {}
  if (contentType.includes('application/json')) {
    try { parsed = JSON.parse(raw) } catch { parsed = {} }
  } else {
    parsed = Object.fromEntries(new URLSearchParams(raw))
  }

  console.log('amocrm webhook payload', JSON.stringify({ contentType, parsed }).slice(0, 3000))

  for (const leadId of extractLeadIds(parsed)) {
    const details = await fetchLeadDetails(leadId)
    const result = await upsertDealFromInbound({
      externalKey: `amocrm:${leadId}`,
      source: 'amocrm',
      customerName: details?.name ?? null,
      customerPhone: details?.phone ?? null,
    })
    if (result.error) console.error('amocrm webhook deal upsert failed', leadId, result.error)
  }

  return NextResponse.json({ ok: true })
}

/** id лидов из form-urlencoded ключей leads[add][N][id] / leads[status][N][id]. */
function extractLeadIds(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  for (const [key, value] of Object.entries(payload)) {
    if (/^leads\[(add|status)\]\[\d+\]\[id\]$/.test(key) && typeof value === 'string' && value) {
      ids.add(value)
    }
  }
  return [...ids]
}

interface LeadDetails {
  name: string | null
  phone: string | null
}

/**
 * Имя лида + телефон первого привязанного контакта через API amoCRM.
 * Любой сбой не должен ронять приём вебхука — сделка заведётся без
 * обогащения, менеджер дозаполнит руками.
 */
async function fetchLeadDetails(leadId: string): Promise<LeadDetails | null> {
  const domain = process.env.AMOCRM_DOMAIN
  const token = process.env.AMOCRM_ACCESS_TOKEN
  if (!domain || !token) return null
  try {
    const headers = { authorization: `Bearer ${token}` }
    const leadRes = await fetch(`https://${domain}/api/v4/leads/${leadId}?with=contacts`, { headers })
    if (!leadRes.ok) return null
    const lead = await leadRes.json()
    const name: string | null = lead?.name || null

    const contactId = lead?._embedded?.contacts?.[0]?.id
    if (!contactId) return { name, phone: null }

    const contactRes = await fetch(`https://${domain}/api/v4/contacts/${contactId}`, { headers })
    if (!contactRes.ok) return { name, phone: null }
    const contact = await contactRes.json()
    const phoneField = (contact?.custom_fields_values ?? []).find(
      (f: { field_code?: string }) => f?.field_code === 'PHONE'
    )
    const phone: string | null = phoneField?.values?.[0]?.value ?? null
    // Имя контакта информативнее безымянного лида вида «Сделка #123».
    const contactName: string | null = contact?.name || null
    return { name: contactName || name, phone }
  } catch (error) {
    console.error('amocrm lead enrich failed', leadId, error)
    return null
  }
}
