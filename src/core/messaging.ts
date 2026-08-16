// Приём и отправка сообщений — общий конвейер для всех каналов.
//
// Канал приносит только две вещи: как разобрать вебхук и как физически
// отправить. Всё остальное — дедупликация, история, предохранители, очередь,
// сделки, ИИ, откат при сбое отправки — происходит здесь, один раз для всех.
//
// Порядок в receive() выверен на живом канале и менять его наугад нельзя.
// Ключевые инварианты:
//   1. Запись входящего — ДО любой логики: она же дедупликация вебхука.
//   2. Сделка и этапы двигаются даже при выключенном боте: «бот молчит» ≠
//      «CRM не ведётся».
//   3. Бронь исходящего в истории — ДО отправки: эхо провайдера ищет свежую
//      запись бота с тем же текстом и без брони опознало бы наш же ответ как
//      сообщение живого менеджера — бот замолкал бы в чате навсегда.
//   4. Транспорт упал — бронь снимается: в переписке не должно остаться
//      сообщения, которого клиент не получил.

import { createAdminClient } from '@/lib/supabase/admin'
import { ai } from './ai'
import * as store from './conversation'
import { crm } from './crm'
import { emit } from './events'
import { runFlow } from './flow/engine'
import { canReply as guardCanReply, type GuardOptions } from './guards'
import { fetchBinary } from './http'
import { createLogger } from './logger'
import { serial, sleep } from './queue'
import { requireChannel } from './registry'
import type { Chat, ChannelIntegration, DialogContext, HistoryItem, InboundMessage, OutboundMessage } from './types'

const MAX_VOICE_BYTES = 20 * 1024 * 1024
const HISTORY_LIMIT = 30

export interface ReceiveOptions extends GuardOptions {
  /**
   * Лаборатория: не дёргать транспорт и не плодить настоящие сделки.
   * Ответы всё равно попадают в историю — этого достаточно, чтобы увидеть
   * поведение бота на тестовом чате.
   */
  dryRun?: boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyChannel = ChannelIntegration<any>

// ─── Чат ─────────────────────────────────────────────────────────────────

interface ChatDeps {
  channel: AnyChannel
  chatId: string
  /** id входящего, от которого считаются id ответов — идемпотентность пачки. */
  sourceId: string
  options: ReceiveOptions
}

function createChat(deps: ChatDeps): Chat {
  const { channel, chatId, sourceId, options } = deps
  const supabase = createAdminClient()
  const log = createLogger(`core:${channel.id}`)
  let counter = 0

  return {
    id: chatId,
    channel: channel.id,

    canReply: () => guardCanReply(supabase, chatId, channel.guards, options),

    history: (limit = HISTORY_LIMIT) => store.history(chatId, { limit }),

    lastBotText: () => store.lastBotText(chatId),

    sentAt: (text) => store.sentAt(chatId, text),

    claim: (key, text) => store.claim(channel.prefix, chatId, key, text),

    async send(message: OutboundMessage): Promise<boolean> {
      const key = message.key ?? String(counter++)
      const id = store.messageId(channel.prefix, `bot:${sourceId}:${key}`)
      const text = message.storeText ?? message.text ?? message.media?.caption ?? '[файл]'

      if (!message.storeOnly && !(await this.canReply())) return false

      let reserved: boolean
      try {
        reserved = await store.write({ id, chatId, direction: 'out', sender: 'bot', text })
      } catch (error) {
        log.error('бронь ответа не прошла', error)
        return false
      }
      // Такой ответ уже записан — значит, эта пачка уже отправлялась.
      // Повтор вебхука не должен слать клиенту то же самое второй раз.
      if (!reserved) return false
      if (message.storeOnly) return true

      if (message.delayMs) await sleep(message.delayMs)

      if (options.dryRun) return true

      try {
        await channel.transport.send(chatId, message)
      } catch (error) {
        await store.remove(id)
        log.error('отправка не прошла', error)
        return false
      }

      await emit('message.sent', { channel: channel.id, chatId, message })
      return true
    },
  }
}

// ─── Приём ───────────────────────────────────────────────────────────────

/**
 * Точка входа для вебхуков. Ставит обработку в очередь чата и возвращает
 * промис — вызывающий может не ждать (вебхуку важно ответить 200 быстро).
 */
export function receive(channelId: string, message: InboundMessage, options: ReceiveOptions = {}): Promise<void> {
  const channel = requireChannel(channelId)
  return serial(`${channelId}:${message.chatId}`, () => process(channel, message, options))
}

async function process(channel: AnyChannel, incoming: InboundMessage, options: ReceiveOptions): Promise<void> {
  const log = createLogger(`core:${channel.id}`)

  const message = await withTranscript(channel, incoming, log)
  if (!message) return

  const messageId = store.messageId(channel.prefix, message.providerMessageId)
  // Ссылка на вложение хранится маркером прямо в тексте: отдельной колонки
  // под медиа нет, а чек менеджеру в карточке сделки нужен (см. MEDIA_MARKER
  // в src/actions/deals.ts).
  const storedText = message.mediaUrl ? `${message.text}\n[media]${message.mediaUrl}` : message.text

  let fresh: boolean
  try {
    fresh = await store.write({
      id: messageId,
      chatId: message.chatId,
      direction: 'in',
      sender: 'client',
      text: storedText,
      authorName: message.authorName,
    })
  } catch (error) {
    log.error('запись входящего не прошла', error)
    return
  }
  if (!fresh) return // повтор вебхука — уже обработано

  const externalKey = await resolveExternalKey(channel, message.chatId)
  await emit('message.inbound', { channel: channel.id, chatId: message.chatId, message })

  // Сделку заводим только под своим ключом. Чужой ключ означает, что клиент
  // уже есть в CRM из другого канала (например, старая сделка amocrm: по тому
  // же номеру) — вторая сделка на того же человека даст split-историю и
  // задвоенные деньги в отчётах.
  if (!options.dryRun && externalKey.startsWith(`${channel.id}:`)) {
    await crm.ensureDeal({
      externalKey,
      source: channel.source,
      customerName: message.authorName,
      customerPhone: message.chatId,
    })
  }

  const chat = createChat({ channel, chatId: message.chatId, sourceId: message.providerMessageId, options })
  const deal = {
    externalKey,
    advance: (action: string) =>
      options.dryRun ? Promise.resolve() : crm.advanceStage(channel.id, externalKey, action),
  }

  // Дальше — только про ответ клиенту. Всё, что относится к CRM (история,
  // сделка), уже сделано и от предохранителей не зависит.
  const allowed = await chat.canReply()

  const context: DialogContext<any> = {
    message,
    chat,
    history: [],
    config: channel.config ? await channel.config.get() : ({} as any),
    deal,
    log,
    dryRun: Boolean(options.dryRun),
  }

  if (allowed && channel.intercept) {
    const handled = await channel.intercept(context)
    if (handled) return
  }

  // Этап двигаем и при молчащем боте: воронка должна отражать разговор,
  // даже если отвечает живой менеджер.
  const stageAction = channel.stageAction?.(message.text) ?? null
  if (stageAction) await deal.advance(stageAction)

  if (!allowed) return

  context.history = await store.history(message.chatId, { limit: HISTORY_LIMIT, excludeId: messageId })

  // Сценарий, собранный владельцем на канве, идёт ПЕРЕД встроенным скриптом:
  // правка из браузера должна побеждать зашитое поведение, иначе смысл
  // конструктора теряется. Ветка со снятой галкой «остановить» пропускает
  // разговор дальше по скрипту.
  const flow = await runFlow(context)
  if (flow.stop) return

  const replies = await channel.reply(context)
  for (const reply of replies) {
    const sent = await chat.send(reply)
    // Не отправилось — дальше по пачке идти нельзя: следующая реплика
    // рассчитана на предыдущую (чек-лист после «оформляем», фото после
    // подводки), и в одиночку она читается как обрывок разговора.
    if (!sent) return
  }
}

/** Голосовое → текст. Канал, который расшифровку не хочет, ставит false. */
async function withTranscript(
  channel: AnyChannel,
  message: InboundMessage,
  log: ReturnType<typeof createLogger>
): Promise<InboundMessage | null> {
  if (message.kind !== 'voice' || !message.mediaUrl || channel.transcribeVoice === false) return message
  try {
    const audio = await fetchBinary(message.mediaUrl, MAX_VOICE_BYTES)
    const extension = new URL(message.mediaUrl).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'ogg'
    const transcript = await ai.transcribe({ audio: audio.bytes, filename: `voice.${extension}` })
    if (!transcript) {
      // Записать «голосовое» без текста нельзя: политика приняла бы его за
      // пустое сообщение и ответила невпопад.
      log.error('расшифровка голосового не удалась', message.providerMessageId)
      return null
    }
    return { ...message, text: transcript }
  } catch (error) {
    log.error('голосовое не скачалось', error)
    return null
  }
}

async function resolveExternalKey(channel: AnyChannel, chatId: string): Promise<string> {
  if (!channel.externalKey) return `${channel.id}:${chatId}`
  return channel.externalKey(chatId)
}

// ─── Сообщение живого менеджера ──────────────────────────────────────────

/**
 * Исходящее, которое отправили не мы (менеджер написал из приложения или
 * веб-интерфейса провайдера). Записывается как sender='operator' — и с этого
 * момента предохранители считают чат занятым живым человеком.
 *
 * Собственное эхо отсеивается по точному совпадению текста: провайдеры
 * присылают наши же отправки тем же типом события.
 */
export async function receiveOperatorMessage(
  channelId: string,
  message: Pick<InboundMessage, 'providerMessageId' | 'chatId' | 'text' | 'authorName'>
): Promise<void> {
  const channel = requireChannel(channelId)
  const log = createLogger(`core:${channel.id}`)
  if (!message.text.trim()) return
  if (await store.isOwnEcho(message.chatId, message.text)) return

  try {
    const written = await store.write({
      id: store.messageId(channel.prefix, message.providerMessageId),
      chatId: message.chatId,
      direction: 'out',
      sender: 'operator',
      text: message.text,
      authorName: message.authorName,
    })
    if (written) {
      await emit('manager.took_over', {
        channel: channel.id,
        chatId: message.chatId,
        authorName: message.authorName,
      })
    }
  } catch (error) {
    log.error('запись сообщения менеджера не прошла', error)
  }
}

/** Отправка вне разговора: рассылка, follow-up планировщика, ручной ответ. */
export async function send(
  channelId: string,
  chatId: string,
  message: OutboundMessage,
  options: ReceiveOptions = {}
): Promise<boolean> {
  const channel = requireChannel(channelId)
  const chat = createChat({
    channel,
    chatId,
    // Свой префикс id, чтобы внешняя отправка не столкнулась с ответами на
    // конкретное входящее сообщение. Без key идемпотентности нет — id
    // получится разным на каждый вызов, и повтор отправит сообщение снова.
    sourceId: message.key ? 'out' : `out:${Date.now()}`,
    options,
  })
  return chat.send(message)
}

/** Чат отдельно от приёма — для планировщиков и ручных сценариев. */
export function chatOf(channelId: string, chatId: string, options: ReceiveOptions = {}): Chat {
  return createChat({ channel: requireChannel(channelId), chatId, sourceId: `manual:${Date.now()}`, options })
}

export type { HistoryItem }
/* eslint-enable @typescript-eslint/no-explicit-any */
