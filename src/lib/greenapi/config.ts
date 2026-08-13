// Настраиваемая часть WhatsApp-бота (шаблоны, куда слать заказы, товароучёт,
// внешние CRM) — хранится в settings.extra.smilekit_whatsapp. Отдельной
// таблицы нет: settings — уже существующий singleton-конфиг компании с
// JSONB-полем extra под ровно такие расширения, заводить миграцию под
// несколько строк текста избыточно.
//
// Читается на каждое сообщение (createAdminClient — один SELECT), пишется
// только из CRM. Это сознательный компромисс простоты: без кэша, зато без
// риска показать в UI не то, что реально применяется ботом.

import { createAdminClient } from '@/lib/supabase/admin'

export interface WhatsappTemplates {
  productInfo: string
  orderChecklist: string
  doubtResult: string
  firstUseEffect: string
  lowStockCta: string
  complaintPrompt: string
  cooperationReply: string
}

export interface OutboundWebhook {
  id: string
  name: string
  url: string
}

export interface WhatsappBotConfig {
  templates: Partial<WhatsappTemplates>
  deliveryGroupId: string | null
  /** Что и как форматировать при отправке подтверждённого заказа в группу. */
  deliveryPrompt: string | null
  /** Внешние системы (Bitrix и т.п.) — на них дублируются события заказов. */
  outboundWebhooks: OutboundWebhook[]
  stock: { quantity: number | null }
}

const DEFAULTS: WhatsappBotConfig = {
  templates: {},
  deliveryGroupId: null,
  deliveryPrompt: null,
  outboundWebhooks: [],
  stock: { quantity: null },
}

const SETTINGS_KEY = 'smilekit_whatsapp'

export async function getWhatsappBotConfig(): Promise<WhatsappBotConfig> {
  const admin = createAdminClient()
  const { data } = await admin.from('settings').select('id, extra').limit(1).maybeSingle()
  const extra = (data as { extra?: Record<string, unknown> } | null)?.extra ?? {}
  const stored = extra[SETTINGS_KEY] as Partial<WhatsappBotConfig> | undefined
  return {
    templates: stored?.templates ?? {},
    deliveryGroupId: stored?.deliveryGroupId ?? null,
    deliveryPrompt: stored?.deliveryPrompt ?? null,
    outboundWebhooks: stored?.outboundWebhooks ?? [],
    stock: stored?.stock ?? { quantity: null },
  }
}

export async function saveWhatsappBotConfig(patch: Partial<WhatsappBotConfig>): Promise<{ success: true } | { success: false; error: string }> {
  const admin = createAdminClient()
  const { data: row } = await admin.from('settings').select('id, extra').limit(1).maybeSingle()
  if (!row) return { success: false, error: 'Таблица settings пуста — компания не инициализирована' }
  const extra = ((row as { extra?: Record<string, unknown> }).extra ?? {}) as Record<string, unknown>
  const current = (extra[SETTINGS_KEY] ?? DEFAULTS) as WhatsappBotConfig
  const next = { ...current, ...patch }
  const { error } = await admin
    .from('settings')
    .update({ extra: { ...extra, [SETTINGS_KEY]: next } })
    .eq('id', (row as { id: string }).id)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** Уменьшает остаток на quantity штук; не даёт уйти в минус. */
export async function decrementStock(quantity: number): Promise<void> {
  const config = await getWhatsappBotConfig()
  const current = config.stock.quantity
  if (current === null) return // товароучёт не включён — ничего не считаем
  await saveWhatsappBotConfig({ stock: { quantity: Math.max(0, current - quantity) } })
}
