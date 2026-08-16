// Follow-up «вам оформить?» через 5 минут молчания клиента после блока
// результата. Скидку сразу вместе с фото больше не шлём — только этот вопрос,
// а скидка (в обычной обработке входящих) появляется, лишь если клиент на
// него ответил отказом.
//
// Тот же паттерн, что у остальных планировщиков проекта: in-process
// setInterval, один инстанс на Railway — дублей нет.
//
// Отправка идёт через ядро: предохранители (менеджер в чате, отписка,
// рубильник), бронь в истории и откат при сбое — те же, что у ответов бота.
// key привязан к id якоря, поэтому повторный тик один и тот же follow-up
// второй раз не отправит.

import { findStaleAnchors, send } from '@/core'
import { FOLLOWUP_ANCHOR_TEXT, ORDER_CTA_FOLLOWUP_TEXT } from './script'

const TICK_INTERVAL_MS = 60_000
const SILENCE_THRESHOLD_MS = 5 * 60_000

let started = false

export function startFollowupScheduler(): void {
  if (started) return
  started = true
  console.log('[greenapi] планировщик follow-up запущен')
  const tick = () => {
    void runOnce().catch((error) => console.error('[greenapi] планировщик follow-up упал', error))
  }
  tick()
  setInterval(tick, TICK_INTERVAL_MS).unref?.()
}

async function runOnce(): Promise<void> {
  const anchors = await findStaleAnchors(FOLLOWUP_ANCHOR_TEXT, SILENCE_THRESHOLD_MS)
  for (const anchor of anchors) {
    await send('greenapi', anchor.chatId, {
      key: `followup:${anchor.id}`,
      text: ORDER_CTA_FOLLOWUP_TEXT,
    })
  }
}
