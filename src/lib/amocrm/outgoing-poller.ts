// Добор исходящих сообщений из amoCRM.
//
// Вебхук add_message шлёт ТОЛЬКО входящие от клиента — ответы менеджера
// (из амо или с телефона WhatsApp Business) к нам не приходят вовсе. Из-за
// этого CRM не видела ответов, а бот не знал, что в чате уже работает
// человек. Раз в минуту опрашиваем Events API (outgoing_chat_message):
// текст сообщения API не отдаёт, поэтому добираем его из истории amojo и
// сохраняем как сообщение менеджера. После этого бот этот чат не трогает.

import { createAdminClient } from '@/lib/supabase/admin'
import { getAmoChatHistory } from '@/lib/amocrm/chat'

const POLL_INTERVAL_MS = 60_000
// Исходящее рядом с нашей же отправкой (бот шлёт через amojo и тоже создаёт
// событие) — не менеджер. Окно с запасом на задержки амо.
const BOT_ECHO_WINDOW_MS = 3 * 60_000

let started = false

export function startAmoOutgoingPoller(): void {
  if (started) return
  started = true
  console.log('amocrm outgoing poller started')
  const tick = () => {
    void pollOnce().catch((error) => console.error('amocrm outgoing poller failed', error))
  }
  tick()
  setInterval(tick, POLL_INTERVAL_MS).unref?.()
}

interface OutgoingEvent {
  id: string
  entity_id: number
  created_at: number
  value_after?: { message?: { id?: string } }[]
}

async function pollOnce(): Promise<void> {
  const domain = process.env.AMOCRM_DOMAIN
  const token = process.env.AMOCRM_ACCESS_TOKEN
  if (!domain || !token) return

  const supabase = createAdminClient()

  // Курсор — в integrations.config (строка amoCRM), переживает рестарты.
  const { data: integrationRow } = await supabase
    .from('integrations')
    .select('config')
    .eq('name', 'amoCRM')
    .maybeSingle()
  const config = ((integrationRow as { config?: Record<string, unknown> } | null)?.config ?? {}) as {
    lastOutgoingEventAt?: number
  }
  // Первый запуск — смотрим только последние 10 минут, не всю историю.
  const since = config.lastOutgoingEventAt ?? Math.floor(Date.now() / 1000) - 600

  const res = await fetch(
    `https://${domain}/api/v4/events?filter[type]=outgoing_chat_message&filter[created_at][from]=${since + 1}&limit=100`,
    { headers: { authorization: `Bearer ${token}` } }
  )
  if (res.status === 204) return
  if (!res.ok) throw new Error(`amoCRM events: HTTP ${res.status}`)
  const data = await res.json()
  const events: OutgoingEvent[] = data?._embedded?.events ?? []
  if (!events.length) return

  let maxAt = since
  const historyByChat = new Map<string, ReturnType<typeof getAmoChatHistory>>()
  for (const event of events) {
    maxAt = Math.max(maxAt, event.created_at)
    const leadId = String(event.entity_id)
    const messageId = event.value_after?.[0]?.message?.id
    if (!messageId) continue

    // chat_id знаем только по уже виденным сообщениям этого лида.
    const { data: known } = await supabase
      .from('amocrm_messages')
      .select('chat_id, contact_id')
      .eq('lead_id', leadId)
      .order('id', { ascending: false })
      .limit(1)
    const chat = (known ?? [])[0] as { chat_id: string; contact_id: string | null } | undefined
    if (!chat) continue

    // Наша же отправка (бот через amojo) создаёт такое же событие — если
    // рядом по времени есть наш bot-ответ в этом чате, это эхо, не менеджер.
    const eventTime = new Date(event.created_at * 1000)
    const { data: botNearby } = await supabase
      .from('amocrm_messages')
      .select('id')
      .eq('chat_id', chat.chat_id)
      .eq('sender', 'bot')
      .gte('created_at', new Date(eventTime.getTime() - BOT_ECHO_WINDOW_MS).toISOString())
      .lte('created_at', new Date(eventTime.getTime() + BOT_ECHO_WINDOW_MS).toISOString())
      .limit(1)
    if (botNearby?.length) continue

    let text = '[ответ менеджера]'
    try {
      let historyPromise = historyByChat.get(chat.chat_id)
      if (!historyPromise) {
        historyPromise = getAmoChatHistory(chat.chat_id, 200)
        historyByChat.set(chat.chat_id, historyPromise)
      }
      const remoteMessage = (await historyPromise).find((item) => item.amoMessageId === messageId)
      if (remoteMessage?.text) text = remoteMessage.text
    } catch (error) {
      console.error('amocrm outgoing poller: message text lookup failed', error)
    }

    await supabase.from('amocrm_messages').upsert(
      {
        amo_message_id: messageId,
        chat_id: chat.chat_id,
        lead_id: leadId,
        contact_id: chat.contact_id,
        direction: 'out',
        sender: 'operator',
        // Events API не отдаёт текст, поэтому добираем его из живой истории
        // amojo. Заглушка остаётся только аварийным вариантом при сбое amojo.
        text,
        created_at: eventTime.toISOString(),
      },
      { onConflict: 'amo_message_id', ignoreDuplicates: true }
    )
  }

  await supabase
    .from('integrations')
    .update({ config: { ...config, lastOutgoingEventAt: maxAt } })
    .eq('name', 'amoCRM')
}
