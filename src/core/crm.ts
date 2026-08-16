// Порты в CRM: сделки, заказы, уведомления.
//
// Смысл файла — граница. Интеграция не должна знать ни про схему таблицы
// deals, ни про то, как считаются этапы воронки: она говорит «клиент готов
// покупать», а как это отражается в CRM — дело ядра. Заодно это единственное
// место, куда придётся заглянуть, если CRM когда-нибудь переедет.

import { advanceDealFromBotAction } from '@/lib/deals/advance-stage'
import { upsertDealFromInbound } from '@/lib/deals/auto-create'
import { ingestOrder, type InboundOrder } from '@/lib/orders/ingest'
import { notify, type NotifyInput } from '@/lib/notifications/notify'
import { createAdminClient } from '@/lib/supabase/admin'
import { emit } from './events'
import { log } from './logger'
import type { DealSource } from '@/types'

export interface EnsureDealInput {
  externalKey: string
  source: DealSource
  customerName?: string | null
  customerPhone?: string | null
}

/** Завести сделку, если её ещё нет. Повторный вызов ничего не дублирует. */
export async function ensureDeal(input: EnsureDealInput): Promise<void> {
  const result = await upsertDealFromInbound(input)
  if (result.error) log.error(`сделка ${input.externalKey}: ${result.error}`)
}

/**
 * Двинуть этап по действию бота ('need_identified' | 'interest_confirmed' |
 * 'ready_to_buy' | 'order' | 'non_standard_request'). Ошибку не бросает:
 * не сдвинувшийся этап не повод не ответить клиенту.
 */
export async function advanceStage(channel: string, externalKey: string, action: string): Promise<void> {
  const result = await advanceDealFromBotAction(externalKey, action)
  if (!result.ok && result.error) {
    log.error(`этап ${action} для ${externalKey}: ${result.error}`)
    return
  }
  if (result.ok) await emit('deal.stage_advanced', { channel, externalKey, action })
}

/** Заказ в CRM. Привязка к сделке — здесь же: ingestOrder про deal_id не знает. */
export async function createOrder(input: InboundOrder & { dealExternalKey?: string }): Promise<void> {
  const result = await ingestOrder(input)
  if (result.error) {
    log.error(`заказ ${input.externalKey}: ${result.error}`)
    return
  }
  if (!input.dealExternalKey) return

  const supabase = createAdminClient()
  const [{ data: deal }, { data: order }] = await Promise.all([
    supabase.from('deals').select('id').eq('external_key', input.dealExternalKey).maybeSingle(),
    supabase.from('orders').select('id').eq('external_key', input.externalKey).maybeSingle(),
  ])
  const dealId = (deal as { id?: string } | null)?.id
  const orderId = (order as { id?: string } | null)?.id
  if (dealId && orderId) await supabase.from('orders').update({ deal_id: dealId }).eq('id', orderId)
}

/** Уведомление менеджерам в CRM. */
export async function notifyTeam(input: NotifyInput): Promise<void> {
  await notify(input)
}

/**
 * Ключ сделки для клиента, который мог прийти в CRM другим каналом.
 *
 * Без этой проверки один и тот же человек получает ВТОРУЮ сделку при смене
 * канала (например, WhatsApp переехал с amoCRM на Green API): два external_key
 * на одного клиента, split-история и задвоенные деньги в отчётах. Найдено на
 * живых данных 2026-08-14 — дубль возник за первые же сутки после переезда.
 *
 * Точное сравнение телефонов не годится: customer_phone хранится в разных
 * форматах ('+996 502 223 421' и '996502223421'), поэтому фильтруем по
 * последним 9 цифрам (локальный номер) и досверяем в коде.
 */
export async function resolveDealKeyByPhone(
  preferredKey: string,
  phone: string,
  fallbackPrefixes: string[]
): Promise<string> {
  const supabase = createAdminClient()
  const { data: own } = await supabase.from('deals').select('id').eq('external_key', preferredKey).maybeSingle()
  if (own) return preferredKey

  const digits = phone.replace(/\D/g, '')
  const suffix = digits.slice(-9)
  if (suffix.length < 9 || !fallbackPrefixes.length) return preferredKey

  const { data: candidates } = await supabase
    .from('deals')
    .select('external_key, customer_phone')
    .ilike('customer_phone', `%${suffix}`)
    .limit(10)

  const match = (candidates ?? []).find((row) => {
    const key = String((row as { external_key: string | null }).external_key || '')
    if (!fallbackPrefixes.some((prefix) => key.startsWith(prefix))) return false
    const rowPhone = String((row as { customer_phone: string | null }).customer_phone || '').replace(/\D/g, '')
    return rowPhone.endsWith(digits) || digits.endsWith(rowPhone)
  })

  return match ? String((match as { external_key: string }).external_key) : preferredKey
}

export const crm = { ensureDeal, advanceStage, createOrder, notifyTeam, resolveDealKeyByPhone }
