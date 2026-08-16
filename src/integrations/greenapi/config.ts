// Настраиваемая часть WhatsApp-канала: то, что владелец правит из CRM
// («Настройки бота»), плюс объявление переменных окружения канала.
//
// Раньше это был отдельный файл с двумя функциями чтения/записи settings.extra;
// теперь то же самое объявляется один раз, а get/save/missingEnv даёт ядро.

import { defineConfig } from '@/core'

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

export interface CustomRule {
  id: string
  /** Regex (без флагов, регистр не важен — всегда 'i') по тексту клиента. */
  trigger: string
  reply: string
  /** Выключить не удаляя — быстро откатить правило без потери текста. */
  enabled: boolean
}

export interface GreenApiConfig {
  templates: Partial<WhatsappTemplates>
  /** Свои правила «условие → ответ»: проверяются до скрипта продаж и до ИИ. */
  customRules: CustomRule[]
  deliveryGroupId: string | null
  /** Что и как форматировать при отправке подтверждённого заказа в группу. */
  deliveryPrompt: string | null
  /** Внешние системы (Bitrix и т.п.) — на них дублируются события заказов. */
  outboundWebhooks: OutboundWebhook[]
  stock: { quantity: number | null }
}

export const greenapiConfig = defineConfig<GreenApiConfig>({
  // Ключ прежний — настройки, введённые владельцем, остаются на месте.
  key: 'smilekit_whatsapp',
  env: {
    GREENAPI_ID_INSTANCE: { description: 'id инстанса Green API', required: true },
    GREENAPI_API_TOKEN_INSTANCE: { description: 'токен инстанса Green API', required: true },
    GREENAPI_API_URL: {
      description: 'хост API инстанса (у каждого инстанса свой, брать в консоли Green API)',
      required: true,
    },
    GREENAPI_MEDIA_URL: { description: 'хост для загрузки медиа, если отличается от API' },
    GREENAPI_WEBHOOK_TOKEN: { description: 'секрет вебхука: приходит как Authorization: Bearer', required: true },
    GREENAPI_ALLOWED_PHONES: {
      description: 'обкатка: номера через запятую, которым бот отвечает. Пусто — отвечаем всем',
    },
  },
  defaults: {
    templates: {},
    customRules: [],
    deliveryGroupId: null,
    deliveryPrompt: null,
    outboundWebhooks: [],
    stock: { quantity: null },
  },
})

/** Уменьшает остаток на quantity штук; не даёт уйти в минус. */
export async function decrementStock(quantity: number): Promise<void> {
  const config = await greenapiConfig.get()
  const current = config.stock.quantity
  if (current === null) return // товароучёт не включён — ничего не считаем
  await greenapiConfig.save({ stock: { quantity: Math.max(0, current - quantity) } })
}
