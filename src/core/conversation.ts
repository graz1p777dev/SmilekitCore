// Хранилище переписки — единственное место в системе, которое знает, в какой
// таблице лежит история и как устроены id сообщений.
//
// Таблица одна на все каналы (amocrm_messages: набор колонок канало-
// независимый), каналы разведены префиксом id: 'ga:<id>' — Green API,
// 'amocrm:<id>' — amoCRM. Отдельная таблица на канал означала бы миграцию
// на каждую новую интеграцию и три места, где «собирается вся переписка
// клиента» — здесь это один SELECT.
//
// UNIQUE(amo_message_id) несёт двойную нагрузку: защита от повторов вебхука
// и атомарный «захват» одноразовых событий (claim) — вставка либо прошла,
// либо нет, без гонки между параллельными обработчиками.

import { createAdminClient } from '@/lib/supabase/admin'
import type { HistoryItem } from './types'

const TABLE = 'amocrm_messages'

type Admin = ReturnType<typeof createAdminClient>

export type Sender = 'client' | 'bot' | 'operator'

export function admin(): Admin {
  return createAdminClient()
}

/** Полный id сообщения в истории: '<префикс канала>:<id у провайдера>'. */
export function messageId(prefix: string, id: string): string {
  return `${prefix}:${id}`
}

interface WriteInput {
  id: string
  chatId: string
  direction: 'in' | 'out'
  sender: Sender
  text: string
  authorName?: string | null
}

/**
 * Записать сообщение. Возвращает false, если такое уже есть — это и есть
 * дедупликация: повтор вебхука не должен второй раз запускать бота.
 */
export async function write(input: WriteInput): Promise<boolean> {
  const { data, error } = await admin()
    .from(TABLE)
    .upsert(
      {
        amo_message_id: input.id,
        chat_id: input.chatId,
        direction: input.direction,
        sender: input.sender,
        author_name: input.authorName ?? null,
        text: input.text,
      },
      { onConflict: 'amo_message_id', ignoreDuplicates: true }
    )
    .select('id')
  if (error) throw new Error(`запись в историю не прошла: ${error.message}`)
  return Boolean(data?.length)
}

/** Убрать запись — откат брони, если транспорт не смог отправить. */
export async function remove(id: string): Promise<void> {
  await admin().from(TABLE).delete().eq('amo_message_id', id)
}

export interface HistoryOptions {
  limit?: number
  /** Не включать это сообщение (обычно — только что записанное входящее). */
  excludeId?: string
}

/** История чата в хронологическом порядке, самое старое первым. */
export async function history(chatId: string, options: HistoryOptions = {}): Promise<HistoryItem[]> {
  const limit = options.limit ?? 30
  const { data } = await admin()
    .from(TABLE)
    .select('amo_message_id, sender, text')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    // При одинаковом created_at (пачка ответов бота уходит в одну секунду)
    // порядок вставки восстанавливает только id.
    .order('id', { ascending: false })
    .limit(limit + 1)
  return (data ?? [])
    .filter((row) => (row as { amo_message_id: string }).amo_message_id !== options.excludeId)
    .slice(0, limit)
    .reverse()
    .map((row) => {
      const sender = (row as { sender: string }).sender
      return {
        role: sender === 'client' ? ('user' as const) : ('assistant' as const),
        content: (row as { text: string }).text,
        sender,
      }
    })
}

/** Текст последней реплики бота — по нему политики понимают, на что отвечает клиент. */
export async function lastBotText(chatId: string): Promise<string> {
  const { data } = await admin()
    .from(TABLE)
    .select('text')
    .eq('chat_id', chatId)
    .eq('sender', 'bot')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { text?: string } | null)?.text ?? ''
}

/**
 * Когда бот в последний раз отправил ровно такой текст. Нужно там, где точка
 * отсчёта — не «сейчас», а момент нашей отправки (например, чек сверяется с
 * днём выдачи QR: клиент получает реквизиты вечером и платит после полуночи).
 */
export async function sentAt(chatId: string, text: string): Promise<Date | null> {
  const { data } = await admin()
    .from(TABLE)
    .select('created_at')
    .eq('chat_id', chatId)
    .eq('text', text)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const value = (data as { created_at?: string } | null)?.created_at
  return value ? new Date(value) : null
}

export async function lastOperatorAt(chatId: string): Promise<number | null> {
  const { data } = await admin()
    .from(TABLE)
    .select('created_at')
    .eq('chat_id', chatId)
    .eq('sender', 'operator')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const value = (data as { created_at?: string } | null)?.created_at
  return value ? new Date(value).getTime() : null
}

// Окно поиска собственного эха. Сутки, а не пять минут: под нагрузкой
// отправка бота доходит до клиента с большой задержкой (на живых данных
// зафиксирован разрыв 21+ минуту), а опоздавшее эхо, не нашедшее себе пары,
// записывалось как сообщение живого менеджера — и бот замолкал в этом чате
// НАВСЕГДА. Точное совпадение текста практически исключает случайное
// совпадение с настоящей репликой человека.
const ECHO_WINDOW_MS = 24 * 3600_000

/** Это наше же отправленное сообщение, вернувшееся вебхуком? */
export async function isOwnEcho(chatId: string, text: string): Promise<boolean> {
  const { data } = await admin()
    .from(TABLE)
    .select('id')
    .eq('chat_id', chatId)
    .eq('sender', 'bot')
    .eq('text', text)
    .gte('created_at', new Date(Date.now() - ECHO_WINDOW_MS).toISOString())
    .limit(1)
  return Boolean(data?.length)
}

/** Писал ли клиент после этого момента — например, за время паузы в сценарии. */
export async function hasClientMessageSince(chatId: string, since: string): Promise<boolean> {
  const { data } = await admin()
    .from(TABLE)
    .select('id')
    .eq('chat_id', chatId)
    .eq('sender', 'client')
    .gt('created_at', since)
    .limit(1)
  return Boolean(data?.length)
}

export interface StaleAnchor {
  id: number
  chatId: string
}

/**
 * Чаты, где маркер с этим текстом — ПОСЛЕДНЯЯ запись и лежит дольше
 * olderThanMs. Основа для отложенных сценариев («молчит 5 минут после
 * блока результата — спросить, оформляем ли»).
 *
 * Проверка «последняя запись» заменяет флаг «отправлено»: любое следующее
 * сообщение — ответ клиента или уже ушедший follow-up — снимает триггер само.
 */
export async function findStaleAnchors(text: string, olderThanMs: number, limit = 200): Promise<StaleAnchor[]> {
  const supabase = admin()
  const { data: anchors } = await supabase
    .from(TABLE)
    .select('id, chat_id')
    .eq('sender', 'bot')
    .eq('text', text)
    .lte('created_at', new Date(Date.now() - olderThanMs).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)
  if (!anchors?.length) return []

  const result: StaleAnchor[] = []
  for (const anchor of anchors as { id: number; chat_id: string }[]) {
    const { data: last } = await supabase
      .from(TABLE)
      .select('id')
      .eq('chat_id', anchor.chat_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if ((last as { id?: number } | null)?.id === anchor.id) result.push({ id: anchor.id, chatId: anchor.chat_id })
  }
  return result
}

/**
 * Одноразовое событие на чат: «фото результатов уже отправляли», «якорь
 * follow-up поставлен». true получает только первый вызвавший — дальше
 * UNIQUE не даёт вставить второй раз. Порт claim_event из Telegram-бота.
 */
export async function claim(prefix: string, chatId: string, key: string, text = `[${key}]`): Promise<boolean> {
  try {
    return await write({
      id: `${prefix}:claim:${key}:${chatId}`,
      chatId,
      direction: 'out',
      sender: 'bot',
      text,
    })
  } catch {
    // Захват — оптимизация, а не корректность: не смогли записать маркер —
    // считаем, что событие уже занято, и молчим. Лучше не отправить второй
    // раз, чем отправить дважды.
    return false
  }
}
