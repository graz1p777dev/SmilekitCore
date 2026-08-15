// Follow-up «вам оформить?» через 5 минут молчания клиента после блока
// результата (see bot-reply.ts: FOLLOWUP_ANCHOR_TEXT). Раньше скидка 13%
// уходила сразу вместе с фото — теперь только этот вопрос, а скидка (в
// обычной обработке входящих, bot-reply.ts) — лишь если клиент ответит «нет».
//
// Тот же паттерн, что campaigns/scheduler.ts и amocrm/outgoing-poller.ts:
// in-process setInterval, один инстанс на Railway — дублей нет.

import { createAdminClient } from '@/lib/supabase/admin'
import { sendGreenApiMessage } from '@/lib/greenapi/client'
import { canSendGreenApiBotReply, FOLLOWUP_ANCHOR_TEXT, ORDER_CTA_FOLLOWUP_TEXT } from '@/lib/greenapi/bot-reply'

const TICK_INTERVAL_MS = 60_000
const SILENCE_THRESHOLD_MS = 5 * 60_000

let started = false

export function startFollowupScheduler(): void {
  if (started) return
  started = true
  console.log('greenapi followup scheduler started')
  const tick = () => {
    void runOnce().catch((error) => console.error('greenapi followup scheduler failed', error))
  }
  tick()
  setInterval(tick, TICK_INTERVAL_MS).unref?.()
}

async function runOnce(): Promise<void> {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - SILENCE_THRESHOLD_MS).toISOString()

  const { data: anchors } = await supabase
    .from('amocrm_messages')
    .select('id, chat_id')
    .eq('sender', 'bot')
    .eq('text', FOLLOWUP_ANCHOR_TEXT)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(200)
  if (!anchors?.length) return

  for (const anchor of anchors as { id: number; chat_id: string }[]) {
    // Якорь ещё актуален, только если это ПОСЛЕДНЯЯ запись в чате — любое
    // следующее сообщение (ответ клиента или уже отправленный follow-up)
    // снимает триггер естественным образом, без отдельного флага «отправлено».
    const { data: last } = await supabase
      .from('amocrm_messages')
      .select('id')
      .eq('chat_id', anchor.chat_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if ((last as { id?: number } | null)?.id !== anchor.id) continue

    if (!(await canSendGreenApiBotReply(supabase, anchor.chat_id))) continue

    const botMessageId = `ga:bot:followup:${anchor.id}`
    const { error: reserveError } = await supabase.from('amocrm_messages').upsert({
      amo_message_id: botMessageId,
      chat_id: anchor.chat_id,
      direction: 'out',
      sender: 'bot',
      text: ORDER_CTA_FOLLOWUP_TEXT,
    }, { onConflict: 'amo_message_id', ignoreDuplicates: true })
    if (reserveError) {
      console.error('greenapi followup scheduler: reserve failed', reserveError.message)
      continue
    }
    try {
      await sendGreenApiMessage(`${anchor.chat_id}@c.us`, ORDER_CTA_FOLLOWUP_TEXT)
    } catch (error) {
      await supabase.from('amocrm_messages').delete().eq('amo_message_id', botMessageId)
      console.error('greenapi followup scheduler: send failed', error)
    }
  }
}
