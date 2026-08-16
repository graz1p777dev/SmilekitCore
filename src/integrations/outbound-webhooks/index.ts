// Дублирование заказов во внешние системы (Bitrix и т.п.).
//
// Адреса задаёт владелец в «Настройках бота» — код при добавлении новой
// системы не меняется вовсе. Отправка намеренно «выстрелил и забыл»: внешний
// сервис лежит — это его проблема, клиент не должен ждать ответа чужого
// сервера, и заказ в CRM уже создан.

import { defineModule, on, request } from '@/core'
import { greenapiConfig } from '../greenapi/config'

export const outboundWebhooks = defineModule({
  id: 'outbound-webhooks',
  title: 'Внешние вебхуки (заказы)',
  setup() {
    on('order.created', async (payload) => {
      const config = await greenapiConfig.get()
      if (!config.outboundWebhooks.length) return

      await Promise.all(
        config.outboundWebhooks.map(async (hook) => {
          const result = await request(hook.url, {
            body: {
              event: 'order.created',
              channel: payload.channel,
              verified: payload.verified,
              customerName: payload.customerName,
              customerPhone: payload.customerPhone,
              address: payload.address,
              receiptUrl: payload.receiptUrl,
            },
            timeoutMs: 10_000,
          })
          if (!result.ok) console.error(`[outbound-webhooks] ${hook.name}: ${result.error}`)
        })
      )
    })
  },
})
