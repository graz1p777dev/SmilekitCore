# Как добавить интеграцию

Три сценария: новый канал (Telegram, Instagram, Max), новый модуль (реакция на
события) и новый ИИ-провайдер. Всё импортируется из `@/core` — внутрь ядра
лезть не нужно; если чего-то не хватает в контракте, это повод дополнить
`core/types.ts`, а не тянуть зависимость мимо границы.

---

## 1. Новый канал

Пример: канал Telegram. Каталог `src/integrations/telegram/`.

### Шаг 1. Транспорт — как физически отправить

```ts
// src/integrations/telegram/transport.ts
import { requestOrThrow, type ChannelTransport, type OutboundMessage } from '@/core'

export const telegramTransport: ChannelTransport = {
  async send(chatId: string, message: OutboundMessage): Promise<void> {
    const base = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
    if (message.media) {
      await requestOrThrow(`${base}/sendPhoto`, {
        body: { chat_id: chatId, photo: message.media.url, caption: message.media.caption },
      })
      return
    }
    await requestOrThrow(`${base}/sendMessage`, { body: { chat_id: chatId, text: message.text } })
  },
}
```

Ошибку бросаем наружу — ядро само снимет бронь в переписке. Ни логов
«не отправилось», ни записи в историю здесь быть не должно.

### Шаг 2. Разбор вебхука — формат провайдера → `InboundMessage`

```ts
// src/integrations/telegram/webhook.ts
import type { InboundMessage } from '@/core'

export function parseWebhook(body: TelegramUpdate): InboundMessage | null {
  const msg = body.message
  if (!msg) return null
  return {
    providerMessageId: String(msg.message_id),
    chatId: String(msg.chat.id),
    authorName: msg.from?.first_name ?? null,
    text: msg.text ?? msg.caption ?? '',
    kind: msg.voice ? 'voice' : msg.photo ? 'image' : 'text',
    mediaUrl: null, // у Telegram ссылка получается отдельным вызовом getFile
  }
}
```

### Шаг 3. Конфиг — переменные и настройки владельца

```ts
// src/integrations/telegram/config.ts
import { defineConfig } from '@/core'

export interface TelegramConfig {
  templates: { greeting?: string }
}

export const telegramConfig = defineConfig<TelegramConfig>({
  key: 'telegram',                     // ключ в settings.extra
  env: {
    TELEGRAM_BOT_TOKEN: { description: 'токен бота', required: true },
    TELEGRAM_ALLOWED_CHATS: { description: 'обкатка: id чатов через запятую' },
  },
  defaults: { templates: {} },
})
```

### Шаг 4. Сценарий — что ответить

```ts
// src/integrations/telegram/policy.ts
import { ai, type DialogContext, type OutboundMessage } from '@/core'
import type { TelegramConfig } from './config'

export async function reply(ctx: DialogContext<TelegramConfig>): Promise<OutboundMessage[]> {
  if (ctx.history.length === 0) {
    return [{ text: ctx.config.templates.greeting || 'Здравствуйте! Чем помочь?' }]
  }
  const answer = await ai.complete({
    message: ctx.message.text,
    history: ctx.history.map((item) => ({ role: item.role, content: item.content })),
  })
  return answer ? [{ text: answer }] : []
}
```

Политика **ничего не отправляет сама** — она возвращает список. Отправка,
предохранители, история и откат — забота ядра.

### Шаг 5. Объявление канала

```ts
// src/integrations/telegram/index.ts
import { defineChannel } from '@/core'
import { telegramConfig, type TelegramConfig } from './config'
import { reply } from './policy'
import { telegramTransport } from './transport'

export const telegram = defineChannel<TelegramConfig>({
  id: 'telegram',
  title: 'Telegram',
  prefix: 'tg',              // префикс id сообщений в общей истории
  source: 'telegram',        // источник сделки в CRM
  transport: telegramTransport,
  config: telegramConfig,
  guards: {
    killSwitch: 'amoCRM',              // общий рубильник бота продаж
    allowlistEnv: 'TELEGRAM_ALLOWED_CHATS',
    respectOptOut: true,
  },
  reply,
})
```

### Шаг 6. Манифест и маршрут

```ts
// src/integrations/index.ts
import { telegram } from './telegram'
register(telegram)
```

```ts
// src/app/api/telegram/webhook/route.ts
import { receive } from '@/core'
import '@/integrations'                 // импорт = регистрация
import { parseWebhook } from '@/integrations/telegram/webhook'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const message = parseWebhook(body)
  if (message) void receive('telegram', message)   // не ждём: вебхуку нужен быстрый 200
  return NextResponse.json({ ok: true })
}
```

Всё. Дедупликация, очередь на чат, история, сделка, этапы, расшифровка
голосовых, предохранители и откат при сбое отправки уже работают.

### Необязательные возможности канала

| Поле | Зачем |
|---|---|
| `intercept(ctx)` | ранняя ветка до сценария; вернула `true` — ядро останавливается (у WhatsApp это чек) |
| `stageAction(text)` | движение этапа сделки по тексту клиента |
| `externalKey(chatId)` | свой ключ сделки: например, найти клиента, пришедшего раньше другим каналом |
| `transcribeVoice: false` | не расшифровывать голосовые |

---

## 2. Новый модуль

Модуль не имеет транспорта — он реагирует на факты. Целиком:

```ts
// src/integrations/crm-alerts/index.ts
import { crm, defineModule, on } from '@/core'

export const crmAlerts = defineModule({
  id: 'crm-alerts',
  title: 'Уведомления менеджерам',
  setup() {
    on('manager.took_over', async ({ chatId }) => {
      await crm.notifyTeam({ type: 'deal', title: `Менеджер взял чат ${chatId}` })
    })
  },
})
```

`setup()` вызывается один раз при регистрации. Ошибка обработчика не ломает
того, кто опубликовал событие, — она только пишется в лог.

Список событий — в [api.md](./api.md#события).

---

## 3. Новый ИИ-провайдер

```ts
// src/core/ai/providers/anthropic.ts
import { requestOrThrow } from '../../http'
import type { AiProvider, CompletionRequest } from '../../types'

export const anthropic: AiProvider = {
  id: 'anthropic',
  kind: 'ai',
  title: 'Anthropic Claude',
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async complete(req: CompletionRequest) {
    const data = await requestOrThrow<{ content: { text: string }[] }>(
      'https://api.anthropic.com/v1/messages',
      {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: {
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
          max_tokens: req.maxTokens ?? 1024,
          system: req.system,
          messages: [...(req.history ?? []), { role: 'user', content: req.message }],
        },
      }
    )
    return data.content?.[0]?.text?.trim() || null
  },
}
```

Добавить в список `ALL` в `src/core/ai/index.ts` — и он доступен через
переменную:

```
AI_PROVIDERS=anthropic,deepseek,openai
```

Реализовывать все три метода не нужно: ядро берёт первого провайдера, который
настроен **и** умеет нужную операцию. DeepSeek не умеет аудио — расшифровка
уйдёт следующему в списке автоматически.

---

## Чек-лист перед мержем

- [ ] Канал не пишет в таблицу переписки напрямую — только через `chat`.
- [ ] Транспорт бросает ошибку вместо того, чтобы её глотать.
- [ ] Все переменные окружения объявлены в `defineConfig({ env })` с описанием.
- [ ] Интеграция добавлена в `src/integrations/index.ts`.
- [ ] `npx tsc --noEmit` и `npx eslint src/core src/integrations` чистые.
- [ ] Prettier на существующих файлах **не запускался** (правило проекта).
