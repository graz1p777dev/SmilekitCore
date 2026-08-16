// amoCRM — пока НЕ на ядре.
//
// Канал продолжает работать по старому пути: src/lib/amocrm/* + маршрут
// src/app/api/amocrm/webhook. Здесь он объявлен только затем, чтобы его
// переменные окружения были описаны там же, где у остальных интеграций,
// и чтобы он был виден в реестре.
//
// Что мешает перенести его прямо сейчас (и что нужно сделать при переносе):
//   1. Транспорт amojo требует leadId и contactId, а не только chatId —
//      ChannelTransport.send получает лишь адрес чата. Нужен резолв
//      leadId/contactId по chatId (есть в deals.external_key = 'amocrm:<id>').
//   2. Свой поллер исходящих (outgoing-poller.ts) дублирует роль вебхука
//      «менеджер написал» — в ядре это receiveOperatorMessage.
//   3. Скрипт продаж в src/lib/amocrm/bot-reply.ts — та же логика, что уже
//      перенесена в src/integrations/greenapi/script.ts. Переносить надо не
//      копией, а переиспользованием: канал отличается транспортом и тем, что
//      картинки через amojo не уходят.
//
// Порядок переноса — в docs/core/migration.md.

import { defineConfig, defineModule } from '@/core'

export const amocrmConfig = defineConfig<Record<string, never>>({
  key: 'amocrm',
  env: {
    AMOCRM_DOMAIN: { description: 'домен аккаунта, например towhite.amocrm.ru', required: true },
    AMOCRM_ACCOUNT_ID: { description: 'id аккаунта amoCRM', required: true },
    AMOCRM_CLIENT_ID: { description: 'client_id интеграции', required: true },
    AMOCRM_CLIENT_SECRET: { description: 'client_secret интеграции', required: true },
    AMOCRM_ACCESS_TOKEN: { description: 'долгосрочный токен интеграции', required: true },
    AMOCRM_WEBHOOK_SECRET: { description: 'секрет в query string URL вебхука', required: true },
  },
  defaults: {},
})

export const amocrm = defineModule({
  id: 'amocrm',
  title: 'amoCRM (легаси-путь, не на ядре)',
  config: amocrmConfig,
})
