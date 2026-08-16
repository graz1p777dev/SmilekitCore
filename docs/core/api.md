# Справочник API ядра

Всё импортируется из `@/core`.

```ts
import { receive, send, chatOf, ai, crm, on, emit, defineChannel, defineModule, defineConfig } from '@/core'
```

---

## Сообщения

### `receive(channelId, message, options?): Promise<void>`

Точка входа для вебхуков: ставит сообщение в очередь чата и прогоняет весь
конвейер (дедупликация → история → сделка → предохранители → сценарий →
отправка). Вебхуку возвращать промис не обязательно — `void receive(...)`.

```ts
void receive('greenapi', {
  providerMessageId: 'ABC123',
  chatId: '996500111222',
  authorName: 'Айгуль',
  text: 'сколько стоит?',
  kind: 'text',        // 'text' | 'voice' | 'image' | 'file'
  mediaUrl: null,
})
```

`options`:

| Поле | Смысл |
|---|---|
| `dryRun` | не дёргать транспорт и не создавать сделки (Лаборатория) |
| `skipKillSwitch` | игнорировать аварийный выключатель (Лаборатория) |

### `send(channelId, chatId, message, options?): Promise<boolean>`

Отправка вне разговора: рассылка, follow-up планировщика, ручной ответ. Делает
то же, что и ответ бота: проверяет предохранители, бронирует запись в истории,
отправляет, откатывает бронь при сбое.

```ts
await send('greenapi', '996500111222', {
  key: `followup:${anchor.id}`,   // без key повторный вызов отправит ещё раз
  text: 'Вам оформить? Пока есть в наличии.',
})
```

Возвращает `false`, если отправить нельзя (менеджер в чате, отписка, рубильник)
или транспорт упал.

### `receiveOperatorMessage(channelId, message): Promise<void>`

Исходящее, отправленное не нами (менеджер написал из приложения провайдера).
Записывается как `operator` — с этого момента чат считается занятым живым
человеком. Собственное эхо отсекается по точному совпадению текста в пределах
суток.

### `chatOf(channelId, chatId, options?): Chat`

Объект чата отдельно от приёма — для планировщиков и ручных сценариев.

---

## `OutboundMessage`

| Поле | Тип | Смысл |
|---|---|---|
| `text` | `string` | текст сообщения |
| `media` | `{ url, fileName, caption?, voice? }` | файл по ссылке; `voice: true` — голосовое |
| `key` | `string` | суффикс id в истории; определяет идемпотентность |
| `storeOnly` | `boolean` | записать в историю, но не отправлять (маркеры, якоря) |
| `storeText` | `string` | что показать в истории вместо `text` (например, `[QR оплаты]`) |
| `delayMs` | `number` | пауза перед отправкой — имитация набора текста |

Если у сообщения есть и `media.voice`, и `text`, то при сбое отправки голосового
транспорт может отправить текст — клиент не остаётся без ответа.

---

## `Chat`

Доступен в сценарии как `ctx.chat`.

| Метод | Что делает |
|---|---|
| `send(message)` | предохранители → бронь → транспорт → откат при ошибке. `false` = не отправлено |
| `canReply()` | можно ли сейчас отвечать в этот чат |
| `claim(key, text?)` | одноразовое событие на чат: `true` только первому вызвавшему |
| `history(limit?)` | история чата, самое старое первым |
| `lastBotText()` | текст последней реплики бота |
| `sentAt(text)` | когда мы в последний раз отправляли ровно такой текст |

`claim` — про «сделать ровно один раз за чат» (отправить фото результата,
поставить якорь). Атомарность обеспечивает уникальный индекс, а не блокировка.

---

## `DialogContext` — что получает сценарий

```ts
async function reply(ctx: DialogContext<MyConfig>): Promise<OutboundMessage[]> {
  ctx.message    // InboundMessage: текст, тип, вложение, автор
  ctx.chat       // Chat
  ctx.history    // HistoryItem[]: { role: 'user' | 'assistant', content, sender }
  ctx.config     // конфиг интеграции, уже прочитанный (один запрос на сообщение)
  ctx.deal       // { externalKey, advance(action) }
  ctx.log        // логгер с префиксом канала
  ctx.dryRun     // Лаборатория
}
```

---

## ИИ

```ts
const answer = await ai.complete({ message, history, system?, json?, maxTokens? })
const text   = await ai.transcribe({ audio: buffer, filename: 'voice.ogg' })
const parsed = await ai.vision({ image: buffer, mime: 'image/jpeg', prompt, json? })
```

Провайдер выбирается по переменной `AI_PROVIDERS` — берётся первый, который
настроен **и** умеет операцию:

```
AI_PROVIDERS=smilekit-bot,deepseek,openai,gemini   # значение по умолчанию
```

| Провайдер | complete | transcribe | vision | Переменные |
|---|---|---|---|---|
| `smilekit-bot` | ✅ (`/internal/lab`) | ✅ | — | `SMILEKIT_BOT_API_URL`, `SMILEKIT_BOT_INTERNAL_TOKEN` |
| `deepseek` | ✅ | — | — | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL` |
| `openai` | ✅ | ✅ | ✅ | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_VISION_MODEL` |
| `gemini` | ✅ | ✅ | ✅ | `GEMINI_API_KEY`, `GEMINI_MODEL` |

`ai.status()` показывает, кто настроен и что умеет — для страницы состояния.

У DeepSeek принудительно выключен `thinking`: включённые по умолчанию
рассуждения съедали весь лимит токенов, и ответ приходил пустым (баг доходил до
прода — клиент получил заглушку).

---

## CRM

```ts
await crm.ensureDeal({ externalKey, source, customerName, customerPhone })
await crm.advanceStage(channel, externalKey, 'ready_to_buy')
await crm.createOrder({ externalKey, dealExternalKey, source, customerPhone, summary, ... })
await crm.notifyTeam({ type: 'deal', title: 'Новый заказ' })
const key = await crm.resolveDealKeyByPhone('greenapi:996500111222', '996500111222', ['amocrm:'])
```

Действия этапов: `need_identified`, `interest_confirmed`, `ready_to_buy`,
`order`, `non_standard_request`.

`resolveDealKeyByPhone` не даёт завести вторую сделку на клиента, который
раньше писал в другой канал: сверка идёт по последним 9 цифрам номера, потому
что телефоны хранятся в разных форматах.

---

## События

```ts
on('order.created', async (payload) => { /* … */ })
await emit('order.created', payload)
```

| Событие | Когда | Payload |
|---|---|---|
| `message.inbound` | входящее записано в историю | `channel, chatId, message` |
| `message.sent` | исходящее ушло клиенту | `channel, chatId, message` |
| `manager.took_over` | живой менеджер написал в чат | `channel, chatId, authorName` |
| `deal.stage_advanced` | этап сделки сдвинулся | `channel, externalKey, action` |
| `order.created` | заказ создан (подтверждён чек) | `channel, chatId, externalKey, verified, customerName, customerPhone, address, receiptUrl` |

`emit` дожидается всех подписчиков, но ошибку каждого только логирует —
подписчик не может сломать того, кто опубликовал факт.

---

## Конфигурация

```ts
const config = defineConfig<MyConfig>({
  key: 'my_integration',                              // ключ в settings.extra
  env: { MY_TOKEN: { description: 'токен', required: true } },
  defaults: { templates: {} },
})

await config.get()              // defaults + сохранённое владельцем
await config.save({ ... })      // { ok: true } | { ok: false, error }
config.missingEnv()             // ['MY_TOKEN'] — чего не хватает
listConfigs()                   // все объявленные конфиги (страница состояния)
requireEnv('MY_TOKEN')          // бросает понятную ошибку вместо fetch(undefined)
envList('ALLOWED_PHONES')       // 'a,b,c' → ['a','b','c']
```

Где что хранить: **env** — секреты и адреса (меняются деплоем), **settings.extra**
— то, что владелец правит из CRM (тексты, правила, id группы).

---

## Переменные

Значение берётся из базы (введено на странице «Интеграции»), а если там пусто —
из переменной окружения.

```ts
await vars.get('GREENAPI_API_URL')          // string | undefined
await vars.requireValue('OPENAI_API_KEY')   // бросает с понятным текстом
await vars.list('GREENAPI_ALLOWED_PHONES')  // 'a,b' → ['a','b']
vars.snapshot('OPENAI_API_KEY')             // синхронно, из кэша (для isConfigured)
await vars.warmup()                         // прогрев кэша при старте

await vars.save({ name: 'MY_TOKEN', value: '…', isSecret: true })
await vars.listAll()                        // для UI: секреты уже замаскированы
```

Секреты шифруются AES-256-GCM ключом `INTEGRATION_ENCRYPTION_KEY`. Подробности —
[panel-and-flows.md](./panel-and-flows.md).

---

## Сценарии

```ts
await runFlow(ctx)                       // вызывается ядром в конвейере приёма
matchRule(rule, matchInput)              // «примерка» без побочных эффектов
await listRules('greenapi')              // все ветки канала
await saveRule({ ... }); await removeRule(id)
startFlowScheduler()                     // планировщик отложенных шагов
```

Модель ветки (`FlowRule`): `conditions` (все должны совпасть) + `actions`
(выполняются по порядку) + `stopAfter` (не отдавать ход встроенному скрипту).
Действие `wait` разрывает цепочку — остаток доигрывает планировщик.

---

## Утилиты

```ts
// HTTP: ошибка значением — для UI; броском — для транспорта
const result = await request<T>(url, { body, retries: 2, timeoutMs: 20_000 })
const data   = await requestOrThrow<T>(url, { body })
const file   = await fetchBinary(url, 20 * 1024 * 1024)   // { bytes, mime }

// Очередь: по ключу — строго последовательно, всего не больше 4 параллельно
await serial(`greenapi:${chatId}`, () => work())
await sleep(700)

// Отложенные сценарии
const anchors = await findStaleAnchors('[ожидание оформления]', 5 * 60_000)

// Реестр
listChannels(); listModules(); getChannel('greenapi'); requireChannel('greenapi')

// Логи с единым префиксом
const log = createLogger('core:greenapi')
```

`request` повторяет только то, что имеет шанс пройти со второй попытки: сетевые
сбои и 5xx. 4xx не повторяется.
