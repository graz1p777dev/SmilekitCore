// Шина событий ядра — то самое место, куда модули подключаются «конструктором».
//
// Правило: событие публикует ядро (или канал), а реагируют модули. Так
// «дублировать заказ во внешний вебхук», «списать остаток», «уведомить
// менеджера» перестают быть кусками кода внутри обработчика сообщения и
// становятся отдельными подписчиками, которые можно выключить, не трогая
// канал.
//
// Обработчики никогда не ломают публикующего: emit() ждёт всех, но ошибку
// каждого только логирует. Событие — уведомление о свершившемся факте, а
// не часть транзакции.

import { log } from './logger'
import type { InboundMessage, OutboundMessage } from './types'

export interface CoreEvents {
  'message.inbound': { channel: string; chatId: string; message: InboundMessage }
  'message.sent': { channel: string; chatId: string; message: OutboundMessage }
  'manager.took_over': { channel: string; chatId: string; authorName: string | null }
  'deal.stage_advanced': { channel: string; externalKey: string; action: string }
  'order.created': {
    channel: string
    chatId: string
    externalKey: string
    verified: boolean
    customerName: string | null
    customerPhone: string
    address: string | null
    receiptUrl: string | null
  }
}

type Handler<E extends keyof CoreEvents> = (payload: CoreEvents[E]) => void | Promise<void>

const handlers = new Map<string, Handler<never>[]>()

export function on<E extends keyof CoreEvents>(event: E, handler: Handler<E>): void {
  const list = handlers.get(event) ?? []
  list.push(handler as Handler<never>)
  handlers.set(event, list)
}

export async function emit<E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]): Promise<void> {
  const list = handlers.get(event)
  if (!list?.length) return
  await Promise.all(
    list.map(async (handler) => {
      try {
        await (handler as Handler<E>)(payload)
      } catch (error) {
        log.error(`обработчик события ${event} упал`, error)
      }
    })
  )
}
