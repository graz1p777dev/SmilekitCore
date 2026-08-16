// Канал WhatsApp через Green API — эталонная интеграция на ядре.
//
// Весь канал — это объявление ниже: транспорт, конфиг, предохранители,
// сценарий. Ни очереди, ни дедупликации, ни записи в историю, ни отката при
// сбое отправки здесь нет — всё это делает ядро одинаково для любого канала.
// Новый канал (Telegram, Instagram, Max) пишется по этому же образцу.

import { crm, defineChannel } from '@/core'
import { greenapiConfig, type GreenApiConfig } from './config'
import { reply } from './policy'
import { handleReceipt } from './receipt'
import { stageActionForInbound } from './script'
import { greenapiTransport } from './transport'

export const greenapi = defineChannel<GreenApiConfig>({
  id: 'greenapi',
  title: 'WhatsApp (Green API)',
  // Префикс id сообщений в общей истории — исторический, менять нельзя:
  // по нему лежит вся уже накопленная переписка канала.
  prefix: 'ga',
  source: 'whatsapp',
  transport: greenapiTransport,
  config: greenapiConfig,
  guards: {
    // Рубильник общий с amoCRM-каналом: это переключатель «бот продаж
    // SmileKit включён», а не именно amoCRM. Имя записи в integrations
    // осталось от прежнего канала — переименование сломало бы кнопку в UI
    // и историю настроек.
    killSwitch: 'amoCRM',
    allowlistEnv: 'GREENAPI_ALLOWED_PHONES',
    respectOptOut: true,
  },
  externalKey: (chatId) => crm.resolveDealKeyByPhone(`greenapi:${chatId}`, chatId, ['amocrm:']),
  intercept: handleReceipt,
  reply,
  stageAction: stageActionForInbound,
})

export { greenapiConfig, type GreenApiConfig } from './config'
export { parseWebhook, isAuthorized, type GreenApiWebhookBody } from './webhook'
export { startFollowupScheduler } from './followup'
