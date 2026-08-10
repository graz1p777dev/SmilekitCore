// ИИ-ответ клиенту в WhatsApp-чате amoCRM.
//
// Мозг — тот же Telegram-бот Smilekit (черновик менеджера + супервизор):
// CRM вызывает его /internal/lab с историей этого чата и отправляет готовый
// ответ через amojo (см. chat.ts). История живёт у нас (amocrm_messages),
// наш сервер — мастер; amoCRM только транспорт.

import { createAdminClient } from '@/lib/supabase/admin'
import { smilekitBotFetch } from '@/lib/smilekit-bot-api'
import { upsertDealFromInbound } from '@/lib/deals/auto-create'
import { advanceDealFromBotAction } from '@/lib/deals/advance-stage'
import { sendAmoChatMessage } from '@/lib/amocrm/chat'

export interface InboundAmoMessage {
  amoMessageId: string
  chatId: string
  leadId: string | null
  contactId: string | null
  authorName: string | null
  text: string
}

// Порт stage_action_for_inbound из бота (smilekit_bot/crm.py) — та же
// трёхуровневая эвристика намерения. Держим синхронно с ботом.
const READY_TO_BUY = /оформ(?:ить|ляйте)|заказ(?:ать|ываю)?|беру\b|покупаю\b|заброниру|резервиру/i
const INTEREST_CONFIRMED = /хочу\b|подходит|устраивает|интересует|готов\s+(?:взять|купить)|давайте/i
const NEED_IDENTIFIED =
  /полоск|отбелив|улыбк|зуб|цена|сколько\s+стоит|состав|инструкц|противопоказ|результат|скидк|доставк|коробк/i

function stageActionForInbound(text: string): string | null {
  const value = text.replace(/ё/g, 'е')
  if (READY_TO_BUY.test(value)) return 'ready_to_buy'
  if (INTEREST_CONFIRMED.test(value)) return 'interest_confirmed'
  if (NEED_IDENTIFIED.test(value)) return 'need_identified'
  return null
}

// Сообщения одного чата обрабатываем строго по очереди: два входящих с
// разницей в секунды иначе генерят два параллельных ответа с одинаковым
// контекстом (клиент получает дубль). Один инстанс на Railway — внутрипроцессной
// цепочки достаточно.
const chatQueues = new Map<string, Promise<void>>()

export function processInboundAmoMessage(input: InboundAmoMessage): Promise<void> {
  const prev = chatQueues.get(input.chatId) ?? Promise.resolve()
  const run = prev.then(() => processInboundAmoMessageNow(input))
  const chain = run.then(
    () => {},
    () => {}
  )
  chatQueues.set(input.chatId, chain)
  chain.then(() => {
    if (chatQueues.get(input.chatId) === chain) chatQueues.delete(input.chatId)
  })
  return run
}

/**
 * Полный цикл на входящее сообщение: сохранить → сделка → ответ ИИ →
 * отправить в amo → сохранить ответ → продвинуть этап.
 * Вызывается detached из вебхука (амо ждёт 200 быстро) — все сбои в console.
 */
async function processInboundAmoMessageNow(input: InboundAmoMessage): Promise<void> {
  const supabase = createAdminClient()

  // Идемпотентность: ретрай вебхука с тем же amo_message_id не отвечает дважды.
  const { data: inserted, error: insertError } = await supabase
    .from('amocrm_messages')
    .upsert(
      {
        amo_message_id: input.amoMessageId,
        chat_id: input.chatId,
        lead_id: input.leadId,
        contact_id: input.contactId,
        direction: 'in',
        sender: 'client',
        author_name: input.authorName,
        text: input.text,
      },
      { onConflict: 'amo_message_id', ignoreDuplicates: true }
    )
    .select('id')
  if (insertError) {
    console.error('amocrm bot-reply: insert failed', insertError.message)
    return
  }
  if (!inserted?.length) return // дубль — уже обработано

  const externalKey = input.leadId ? `amocrm:${input.leadId}` : `amocrm-chat:${input.chatId}`
  await upsertDealFromInbound({
    externalKey,
    source: 'amocrm',
    customerName: input.authorName,
    customerPhone: input.authorName?.match(/^\+?[\d\s()-]{7,}$/) ? input.authorName : null,
  })

  // История чата для ИИ: всё до текущего сообщения, старые → новые.
  const { data: rows } = await supabase
    .from('amocrm_messages')
    .select('sender, text, id')
    .eq('chat_id', input.chatId)
    .order('id', { ascending: false })
    .limit(31)
  const history = (rows ?? [])
    .reverse()
    .slice(0, -1) // текущее сообщение уходит отдельным параметром message
    .map((row) => ({
      role: (row as { sender: string }).sender === 'client' ? 'user' : 'assistant',
      content: (row as { text: string }).text,
    }))

  const lab = await smilekitBotFetch<{ reply: string }>('/internal/lab', {
    method: 'POST',
    body: { message: input.text, history },
  })
  if (!lab.ok) {
    console.error('amocrm bot-reply: lab failed', lab.error)
    return
  }
  const reply = lab.data.reply?.trim()
  if (!reply) return

  try {
    await sendAmoChatMessage({
      chatId: input.chatId,
      leadId: input.leadId,
      contactId: input.contactId,
      text: reply,
    })
  } catch (error) {
    console.error('amocrm bot-reply: send failed', error)
    return
  }

  await supabase.from('amocrm_messages').insert({
    amo_message_id: `bot:${input.amoMessageId}`,
    chat_id: input.chatId,
    lead_id: input.leadId,
    contact_id: input.contactId,
    direction: 'out',
    sender: 'bot',
    text: reply,
  })

  const action = stageActionForInbound(input.text)
  if (action) {
    const result = await advanceDealFromBotAction(externalKey, action)
    if (!result.ok && result.error) {
      console.error('amocrm bot-reply: stage advance failed', action, result.error)
    }
  }
}
