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

// ─── Скрипт продаж — порт из Telegram-бота (smilekit_bot/templates.py,
// sales.py, __main__.py). Тексты дословно по ТЗ, держим синхронно с ботом.
// Отличие канала: QR-картинку и фото в WhatsApp через amojo не передать,
// поэтому на этапе оплаты сделка передаётся менеджеру.

const PRODUCT_INFO =
  'Здравствуйте! 😊\n\n' +
  'SmileKit помогает заметно отбелить зубы уже после первого применения.\n\n' +
  '📦 В наборе 14 отбеливающих полосок — это полный курс.\n\n' +
  '💰 ЦЕНА — 1490 СОМ.🇰🇬'

const CITY_QUESTION = 'Подскажите, пожалуйста, из какого вы города?'

const FIRST_USE_EFFECT =
  'Вот такой эффект будет уже после первого применения😁. После курса эффект будет постоянный✅😊'

const ORDER_CHECKLIST =
  'Чтобы оформить заказ, пожалуйста, отправьте 😊\n\n' +
  '• адрес доставки;\n\n' +
  '• ваше имя;\n\n' +
  '• номер телефона.\n\n' +
  'Менеджер свяжется с вами для оплаты и подтверждения заказа.'

const COMPLAINT_PROMPT = 'Подскажите, пожалуйста, что вас не устроило — для улучшения нашего сервиса.'

const COOPERATION_REPLY =
  'Спасибо за интерес! Вопросами сотрудничества и опта занимается наш менеджер — он свяжется с вами в ближайшее время.'

const DELIVERY_TEMPLATES: [RegExp, string][] = [
  [/бишкек|токмок/, 'Отлично, у нас есть доставка через Яндекс, за 30 минут доставим'],
  [
    /\bош\b|джалал-?абад|каракол|нарын|талас|баткен|балыкч/,
    'Да, у нас есть доставка через Ылдам Экспресс 🚚✅. Если оформить сейчас, доставка будет уже завтра или послезавтра',
  ],
  [/алмат/, 'Да, доставим! В Алматы — ориентировочно в течение 30 минут'],
  [/астан/, 'Да, доставим! По остальным регионам Казахстана — ориентировочно за 1–3 дня'],
  [/ташкент/, 'Да, доставим! В Ташкенте — ориентировочно в течение 1 часа'],
  [
    /москв|росси/,
    'Своего склада в России нет, отправляем через СДЭК — доставка от 7 дней. Точную стоимость доставки уточним отдельно',
  ],
]

function deliveryTemplateForCity(text: string): string | null {
  const normalized = text.toLowerCase()
  for (const [pattern, template] of DELIVERY_TEMPLATES) {
    if (pattern.test(normalized)) return template
  }
  return null
}

// sales.py: _ORDER_INTENT + _PAYMENT_INFO_REQUEST — клиент готов оформлять
// или спрашивает, как платить.
const ORDER_INTENT =
  /хочу\s+(?:заказать|купить|взять)|(?:как|где)\s+(?:заказать|купить|оформить)|закажу|заказать|оформить|оформляйте|оформляем|\bберу\b|возьму|можно\s+оформить|реквизит|куда\s+(?:скинуть|перевести|оплатить|платить)|как\s+оплатить|способ\s+оплаты|\bqr[\s-]?код/i

// templates.py: DOUBT_RESULT_REPLY — дословно по ТЗ, «гарантируем», без
// «у большинства». Срабатывает на сомнения в честности/реальности ДО покупки.
const DOUBT_RESULT_REPLY =
  'Вы можете зайти в наш Instagram и посмотреть результаты других клиентов. ' +
  'Мы гарантируем эффект уже после первого применения.'

// sales.py: _SCAM_DOUBT + формулировки из реальных диалогов WhatsApp
// («это все реально да», «без обмана»). Проверяется раньше жалоб —
// слова пересекаются.
const SCAM_DOUBT =
  /(?:вы\s+)?(?:точно\s+)?не\s+мошенник|мошенники\s*\?|(?:это\s+)?(?:точно\s+)?не\s+(?:обман|развод|скам|фейк)|без\s+обмана|(?:это\s+)?(?:все|всё)?\s*реально\s*(?:да|\?)|не\s+кин[её]те|вам\s+можно\s+доверять|можно\s+(?:ли\s+)?вам\s+верить|вы\s+настоящие/i

// sales.py: _COMPLAINT_MARKERS / _COOPERATION_MARKERS.
const COMPLAINT =
  /развод|обман(?:ули)?|кинул|мошенник|верните\s+деньги|хочу\s+возврат|ужасн(?:о|ый|ая)|отвратительн|никогда\s+(?:больше\s+)?не\s+куплю|не\s+помогл|разочарован/i
const COOPERATION =
  /сотрудничеств|оптом|\bопт\b|дистрибьютор|дилер|партн[её]р|реселлер|перепродаж|b2b|блогер/i

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

/**
 * Исходящее сообщение из вебхука. Если это НЕ эхо только что отправленного
 * ботом текста — в чат вступил живой менеджер (из амо или WhatsApp Business):
 * сохраняем как operator, и бот этот чат больше не трогает вообще
 * (см. проверку в processInboundAmoMessageNow).
 */
export async function registerOutgoingAmoMessage(input: InboundAmoMessage): Promise<void> {
  const supabase = createAdminClient()
  const { data: recentBot } = await supabase
    .from('amocrm_messages')
    .select('id')
    .eq('chat_id', input.chatId)
    .eq('sender', 'bot')
    .eq('text', input.text)
    .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
    .limit(1)
  if (recentBot?.length) return // эхо нашей же отправки через amojo

  await supabase.from('amocrm_messages').upsert(
    {
      amo_message_id: input.amoMessageId,
      chat_id: input.chatId,
      lead_id: input.leadId,
      contact_id: input.contactId,
      direction: 'out',
      sender: 'operator',
      text: input.text,
    },
    { onConflict: 'amo_message_id', ignoreDuplicates: true }
  )
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
  // Аварийный выключатель: integrations.amoCRM.is_active. Выключен — историю
  // и сделки продолжаем вести, но клиенту не отвечаем и этапы не двигаем.
  const { data: integration } = await supabase
    .from('integrations')
    .select('is_active')
    .eq('name', 'amoCRM')
    .maybeSingle()
  const botEnabled = Boolean((integration as { is_active?: boolean } | null)?.is_active)
  await upsertDealFromInbound({
    externalKey,
    source: 'amocrm',
    customerName: input.authorName,
    customerPhone: input.authorName?.match(/^\+?[\d\s()-]{7,}$/) ? input.authorName : null,
  })
  // В чате уже писал живой менеджер — бот его не трогает вообще: ни ответов,
  // ни этапов. Диалог целиком ведёт человек.
  const { data: operatorRows } = await supabase
    .from('amocrm_messages')
    .select('id')
    .eq('chat_id', input.chatId)
    .eq('sender', 'operator')
    .limit(1)
  if (operatorRows?.length) return

  // Этапы двигаются ВСЕГДА по намерению клиента — даже когда бот выключен:
  // выключатель глушит только ответы, а не трекинг воронки.
  const inboundAction = COMPLAINT.test(input.text) || COOPERATION.test(input.text)
    ? 'non_standard_request'
    : stageActionForInbound(input.text)
  if (inboundAction) {
    const advanced = await advanceDealFromBotAction(externalKey, inboundAction)
    if (!advanced.ok && advanced.error) {
      console.error('amocrm bot-reply: stage advance failed', inboundAction, advanced.error)
    }
  }

  if (!botEnabled) return

  // История чата: всё до текущего сообщения, старые → новые.
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
  const historyText = history.map((item) => item.content.toLowerCase()).join(' ')

  // Скриптовые ветки — как в Telegram-обработчике (__main__.py), без ИИ.
  const replies: string[] = []
  let stageAction: string | null = null
  const deliveryTemplate = deliveryTemplateForCity(input.text)

  if (history.length === 0) {
    // Первый контакт — дословный скрипт: цена + вопрос о городе.
    replies.push(`${PRODUCT_INFO}\n\n${CITY_QUESTION}`)
  } else if (SCAM_DOUBT.test(input.text)) {
    replies.push(DOUBT_RESULT_REPLY)
  } else if (COMPLAINT.test(input.text)) {
    replies.push(COMPLAINT_PROMPT)
  } else if (COOPERATION.test(input.text)) {
    replies.push(COOPERATION_REPLY)
  } else if (ORDER_INTENT.test(input.text)) {
    // Готов оформлять. QR в WhatsApp не передать — данные собирает бот,
    // оплату закрывает менеджер: сделка сразу «Передан менеджеру».
    replies.push(ORDER_CHECKLIST)
    stageAction = 'order'
  } else if (deliveryTemplate && (historyText.includes('цена') || historyText.includes('сом'))) {
    // Клиент назвал город после цены — готовый сценарий: доставка, эффект, CTA.
    replies.push(deliveryTemplate, FIRST_USE_EFFECT, 'Вам оформить доставку?')
  }

  if (replies.length === 0) {
    // Не скриптовый случай — обычная генерация тем же мозгом бота
    // (черновик менеджера + супервизор из настроек CRM).
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
    // Бот делит длинный ответ тегом <NEXT_MESSAGE> (Telegram шлёт частями) —
    // в WhatsApp тег утекал клиенту текстом. Делим так же, как Telegram.
    replies.push(
      ...reply
        .split(/<NEXT_MESSAGE>/i)
        .map((part) => part.trim())
        .filter(Boolean)
    )
    if (replies.length === 0) return
  }

  for (let index = 0; index < replies.length; index++) {
    const text = replies[index]
    try {
      await sendAmoChatMessage({
        chatId: input.chatId,
        leadId: input.leadId,
        contactId: input.contactId,
        text,
      })
    } catch (error) {
      console.error('amocrm bot-reply: send failed', error)
      return
    }
    await supabase.from('amocrm_messages').insert({
      amo_message_id: `bot:${input.amoMessageId}:${index}`,
      chat_id: input.chatId,
      lead_id: input.leadId,
      contact_id: input.contactId,
      direction: 'out',
      sender: 'bot',
      text,
    })
    if (index < replies.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 900 + Math.random() * 500))
    }
  }

  // Ветки скрипта могут поднять этап дальше базовой эвристики (например
  // «order» после чек-листа оформления) — базовый inboundAction уже применён выше.
  if (stageAction) {
    const result = await advanceDealFromBotAction(externalKey, stageAction)
    if (!result.ok && result.error) {
      console.error('amocrm bot-reply: stage advance failed', stageAction, result.error)
    }
  }
}
