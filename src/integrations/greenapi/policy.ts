// Сценарий разговора: что ответить клиенту.
//
// Политика ничего не отправляет сама — она возвращает список сообщений, а
// ядро уже решает, можно ли их слать, пишет их в историю и откатывает при
// сбое. Отсюда главное свойство: сценарий читается сверху вниз как скрипт
// продаж, а не как код с отправкой вперемешку.
//
// Порядок веток в цепочке if/else — рабочий и выстраданный: каждая следующая
// ветка ловит то, что не поймала предыдущая. Перестановка меняет поведение
// бота, даже если условия выглядят независимыми.

import { ai, type DialogContext, type OutboundMessage } from '@/core'
import type { GreenApiConfig } from './config'
import { mediaBaseUrl } from './transport'
import * as script from './script'

// Пауза между репликами: живой человек не отвечает тремя сообщениями в одну
// миллисекунду.
const REPLY_DELAY_MS = 900
const PHOTO_DELAY_MS = 700

export async function reply(ctx: DialogContext<GreenApiConfig>): Promise<OutboundMessage[]> {
  const { message, chat, config } = ctx
  const text = message.text

  // Ссылки из истории выкидываем: клиент присылает их из рекламы, и для
  // модели это шум, который она принимает за контекст разговора.
  const history = ctx.history.filter((item) => !script.LINK_IN_MESSAGE.test(item.content))
  const historyText = history.map((item) => item.content.toLowerCase()).join(' ')
  const isKyrgyz = script.KYRGYZ_MARKERS.test(text)
  const priceKnown = historyText.includes('цена') || historyText.includes('сом')
  const lastBotMessage = [...history].reverse().find((item) => item.role === 'assistant')?.content ?? ''
  const acceptedOrderCta = script.AFFIRMATIVE_ONLY.test(text) && script.ORDER_CTA_MARKER.test(lastBotMessage)

  const looksLikeLocationAnswer = script.shouldSendResultsAfterLocation(text, historyText)
  // Город не совпал ни с одним regex (село, малый населённый пункт) — но раз
  // это похоже на ответ про город, шлём заранее утверждённый региональный
  // шаблон, а не отдаём вопрос ИИ: тот выдумывал сроки и стоимость доставки.
  const deliveryTemplate =
    script.deliveryTemplateForCity(text) ?? (looksLikeLocationAnswer ? script.REGIONAL_DELIVERY_TEMPLATE : null)

  // Тексты, редактируемые из CRM («Настройки бота» → «Шаблоны»): пустая
  // строка означает «не переопределено», берём дефолт.
  const T = {
    productInfo: config.templates.productInfo || script.PRODUCT_INFO,
    orderChecklist: config.templates.orderChecklist || script.ORDER_CHECKLIST,
    doubtResult: config.templates.doubtResult || script.DOUBT_RESULT_REPLY,
    firstUseEffect: config.templates.firstUseEffect || script.FIRST_USE_EFFECT,
    lowStockCta: config.templates.lowStockCta || script.LOW_STOCK_DISCOUNT_CTA,
    complaintPrompt: config.templates.complaintPrompt || script.COMPLAINT_PROMPT,
    cooperationReply: config.templates.cooperationReply || script.COOPERATION_REPLY,
  }

  // Блок «после города» (доставка + фото + голосовое + CTA) уходит ровно один
  // раз за чат. Условия-триггеры остаются верными и дальше по диалогу
  // (название города всплывает в адресе, любой короткий ответ проходит
  // проверку), и без захвата бот повторял голосовое «эффект с первого раза»
  // уже во время оформления заказа — не к месту.
  const wantsResultsBlock = looksLikeLocationAnswer || Boolean(deliveryTemplate && priceKnown)
  const resultsBlockAllowed = wantsResultsBlock ? await chat.claim('results', '[фото до/после]') : false

  const replies: string[] = []
  const voiceReplies = new Set<string>()
  let sendPaymentQr = false
  let needsFollowupAnchor = false
  let orderIntent = false

  // Свои правила из настроек CRM — раньше встроенного скрипта: владелец может
  // перекрыть штатное поведение, не трогая код. Первое совпавшее enabled-
  // правило побеждает; кривой regex ломает только само правило.
  const customRuleReply = matchCustomRule(config, text, ctx)

  if (customRuleReply) {
    replies.push(customRuleReply)
  } else if (history.length > 0 && script.GREETING_ONLY.test(text)) {
    const pool = isKyrgyz ? script.RETURNING_KYRGYZ_GREETING_REPLIES : script.RETURNING_GREETING_REPLIES
    replies.push(pool[Math.floor(Math.random() * pool.length)])
  } else if (script.LINK_IN_MESSAGE.test(text) || script.GREETING_ONLY.test(text)) {
    replies.push(T.productInfo, script.CITY_QUESTION)
  } else if (isKyrgyz && script.KYRGYZ_PRICE_INTENT.test(text)) {
    replies.push(script.KYRGYZ_PRODUCT_INFO)
  } else if (history.length === 0) {
    replies.push(T.productInfo, script.CITY_QUESTION)
  } else if (script.SCAM_DOUBT.test(text)) {
    replies.push(T.doubtResult)
    voiceReplies.add(T.doubtResult)
  } else if (script.COMPLAINT.test(text)) {
    replies.push(T.complaintPrompt)
  } else if (script.COOPERATION.test(text)) {
    replies.push(T.cooperationReply)
  } else if (script.NEGATIVE_ONLY.test(text) && lastBotMessage === script.ORDER_CTA_FOLLOWUP_TEXT) {
    // Клиент отказался оформлять на follow-up «вам оформить?» — только здесь
    // и появляется скидка 13%, сразу после результата её не шлём.
    replies.push(T.lowStockCta)
  } else if (script.ORDER_INTENT.test(text) || acceptedOrderCta) {
    // QR уходит сразу вместе с чек-листом: Green API картинки шлёт, ждать
    // отдельного «подтверждения» перед выдачей реквизитов больше не нужно.
    replies.push(T.orderChecklist)
    sendPaymentQr = true
    orderIntent = true
  } else if (deliveryTemplate && priceKnown && resultsBlockAllowed) {
    replies.push(deliveryTemplate, T.firstUseEffect)
    voiceReplies.add(T.firstUseEffect)
    needsFollowupAnchor = true
  }

  // Скрипт не сработал — отвечает модель (по умолчанию тот же мозг, что в
  // Telegram: /internal/lab у бота SmileKit).
  if (replies.length === 0) {
    const generated = await generate(text, history, isKyrgyz, ctx)
    if (!generated.length) return []
    replies.push(...generated)
  }

  if (orderIntent) await ctx.deal.advance('order')

  return assemble({
    replies,
    voiceReplies,
    sendPaymentQr,
    resultsBlockAllowed,
    needsFollowupAnchor,
    firstUse: T.firstUseEffect,
    base: await mediaBaseUrl(),
  })
}

function matchCustomRule(config: GreenApiConfig, text: string, ctx: DialogContext<GreenApiConfig>): string | null {
  for (const rule of config.customRules) {
    if (!rule.enabled || !rule.trigger.trim()) continue
    try {
      if (new RegExp(rule.trigger, 'i').test(text)) return rule.reply
    } catch (error) {
      ctx.log.error(`своё правило ${rule.id}: некорректный regex`, error)
    }
  }
  return null
}

async function generate(
  text: string,
  history: DialogContext<GreenApiConfig>['history'],
  isKyrgyz: boolean,
  ctx: DialogContext<GreenApiConfig>
): Promise<string[]> {
  const message = isKyrgyz
    ? `${text}\n\nЖоопту толугу менен кыргыз тилинде бер. Орусча сөздөрдү аралаштырба.`
    : text
  let generated: string | null = null
  try {
    generated = await ai.complete({
      message,
      history: history.map((item) => ({ role: item.role, content: item.content })),
    })
  } catch (error) {
    ctx.log.error('модель не ответила', error)
    return []
  }
  if (!generated) return []
  // Модель разбивает длинный ответ на несколько сообщений сама — маркером.
  return generated
    .split(/<NEXT_MESSAGE>/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

interface AssembleInput {
  replies: string[]
  voiceReplies: Set<string>
  sendPaymentQr: boolean
  resultsBlockAllowed: boolean
  needsFollowupAnchor: boolean
  firstUse: string
  /** Адрес медиафайлов бота; null — шлём только текст. */
  base: string | null
}

/**
 * Собирает готовую пачку в том порядке, в каком её увидит клиент:
 * первая реплика → QR → подводка и фото результата → остальные реплики.
 * Медиа (голосовые, QR, фото) отправляются только если известен адрес
 * файлов бота — без него шлём тот же текст, а не молчим.
 */
function assemble(input: AssembleInput): OutboundMessage[] {
  const base = input.base
  const out: OutboundMessage[] = []

  const asMessage = (text: string, index: number): OutboundMessage => {
    const message: OutboundMessage = { text, key: String(index) }
    if (index > 0) message.delayMs = REPLY_DELAY_MS + Math.floor(Math.random() * 500)
    if (input.voiceReplies.has(text) && base) {
      // Те же файлы, что шлёт Telegram-бот. В историю пишем текст — голосовое
      // и текстовая версия для менеджера это одна и та же реплика.
      const fileName = text === input.firstUse ? 'first_use_effect.ogg' : 'not_scam.ogg'
      message.media = { url: `${base}/media/voice/${fileName}`, fileName, voice: true }
      message.storeText = text
    }
    return message
  }

  out.push(asMessage(input.replies[0], 0))

  if (input.sendPaymentQr && base) {
    out.push({
      key: 'qr',
      media: { url: `${base}/media/results/qrcode.jpeg`, fileName: 'qrcode.jpeg' },
      storeText: script.QR_STORE_TEXT,
    })
  }

  if (input.resultsBlockAllowed && base) {
    out.push({ key: 'results-intro', text: script.RESULTS_INTRO })
    for (const [name, caption] of script.RESULT_PHOTOS) {
      out.push({
        key: `result:${name}`,
        media: { url: `${base}/media/results/${name}`, fileName: name, caption: caption || undefined },
        storeText: caption || '[фото результата]',
        delayMs: PHOTO_DELAY_MS,
      })
    }
  }

  for (let index = 1; index < input.replies.length; index++) {
    out.push(asMessage(input.replies[index], index))
  }

  if (input.needsFollowupAnchor) {
    // Маркер только в БД, клиенту не уходит: followup.ts раз в минуту ищет
    // чаты, где это последняя запись и прошло 5+ минут тишины.
    out.push({ key: 'followup-anchor', storeOnly: true, storeText: script.FOLLOWUP_ANCHOR_TEXT })
  }

  return out
}
