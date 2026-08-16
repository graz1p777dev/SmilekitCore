// Скрипт продаж SmileKit: тексты и правила распознавания.
//
// Здесь нет ни одного обращения к БД, сети или ядру — только константы и
// чистые функции. Это сделано нарочно: скрипт правится чаще всего и должен
// читаться (и обсуждаться с владельцем) без знания архитектуры. Всё, что
// умеет побочные эффекты, живёт в policy.ts.
//
// Тексты дословны и синхронизированы с Telegram-ботом — менять их «на глаз»
// нельзя, это утверждённые формулировки.

import {
  DEFAULT_COMPLAINT_PROMPT,
  DEFAULT_COOPERATION_REPLY,
  DEFAULT_DOUBT_RESULT_REPLY,
  DEFAULT_FIRST_USE_EFFECT,
  DEFAULT_LOW_STOCK_CTA,
  DEFAULT_ORDER_CHECKLIST,
  DEFAULT_PRODUCT_INFO,
} from '@/lib/greenapi/default-templates'

export const PRODUCT_INFO = DEFAULT_PRODUCT_INFO
export const FIRST_USE_EFFECT = DEFAULT_FIRST_USE_EFFECT
export const LOW_STOCK_DISCOUNT_CTA = DEFAULT_LOW_STOCK_CTA
export const ORDER_CHECKLIST = DEFAULT_ORDER_CHECKLIST
export const COMPLAINT_PROMPT = DEFAULT_COMPLAINT_PROMPT
export const COOPERATION_REPLY = DEFAULT_COOPERATION_REPLY
export const DOUBT_RESULT_REPLY = DEFAULT_DOUBT_RESULT_REPLY

export const KYRGYZ_PRODUCT_INFO =
  'Салам! 😊 Бир кутусу — 1490 сом. Ичинде 14 даана тилке бар — бул толук курс. ' +
  'Таасири биринчи колдонуудан кийин эле байкалат.\n\n' +
  'Кайсы шаардан болосуз? Жеткирүү боюнча айтып берем.'

export const KYRGYZ_MARKERS =
  /баа|наркы|канча|кайсы|шаар|жеткир|тиш|агарт|колдон|куту|барбы|алам|керек|рахмат|болобу|кантип|эмне/i
export const KYRGYZ_PRICE_INTENT = /баа|наркы|канча\s*(?:сом|турат)/i
export const LINK_IN_MESSAGE = /(?:https?:\/\/|www\.)\S+/i
export const GREETING_ONLY =
  /^\s*(?:улыбка|здравствуйте|здравствуй|привет|добрый\s+(?:день|вечер|утро))[!,.?\s😊👋]*$/iu

export const CITY_QUESTION = 'Подскажите, пожалуйста, из какого вы города?'

export const RETURNING_GREETING_REPLIES = [
  'Здравствуйте! 😊 Рада снова вас видеть. Чем могу помочь?',
  'Здравствуйте! 😊 Конечно, я на связи. Что подсказать?',
  'Здравствуйте! 😊 Продолжим — чем могу помочь?',
]

export const RETURNING_KYRGYZ_GREETING_REPLIES = [
  'Салам! 😊 Кайрадан көргөнүмө кубанычтамын. Кантип жардам берейин?',
  'Салам! 😊 Мен байланышта элем. Эмне боюнча жардам керек?',
]

// Регионы Кыргызстана/Казахстана вне Бишкека/Токмока едут одной и той же
// «Ылдам Экспресс» — этот же текст служит и явным совпадением по городу,
// и запасным вариантом для сёл и малых населённых пунктов, которых нет и не
// может быть в списке regex: раньше такие случаи (например, «Село.Арчалы»)
// уходили в ИИ, который сам выдумывал сроки и стоимость доставки.
export const REGIONAL_DELIVERY_TEMPLATE =
  'Да, у нас есть доставка через Ылдам Экспресс 🚚✅ За 1 день доставим прям до дома.'

const DELIVERY_TEMPLATES: [RegExp, string][] = [
  [/бишкек|токмок/, 'Отлично, у нас есть доставка через Яндекс, за 30 минут доставим'],
  [/\bош\b|джалал-?абад|каракол|нарын|талас|баткен|балыкч|манас/, REGIONAL_DELIVERY_TEMPLATE],
  [/алмат/, 'Да, доставим! В Алматы — ориентировочно в течение 30 минут'],
  [/астан/, 'Да, доставим! По остальным регионам Казахстана — ориентировочно за 1–3 дня'],
  [/ташкент/, 'Да, доставим! В Ташкенте — ориентировочно в течение 1 часа'],
  [
    /москв|росси/,
    'Своего склада в России нет, отправляем через СДЭК — доставка от 7 дней. Точную стоимость доставки уточним отдельно',
  ],
]

export function deliveryTemplateForCity(text: string): string | null {
  const normalized = text.toLowerCase()
  for (const [pattern, template] of DELIVERY_TEMPLATES) {
    if (pattern.test(normalized)) return template
  }
  return null
}

export function shouldSendResultsAfterLocation(text: string, historyText: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  const priorPrice = historyText.includes('цена') || historyText.includes('сом')
  if (!priorPrice || LINK_IN_MESSAGE.test(text) || GREETING_ONLY.test(text)) return false
  const askedForCity = historyText.includes('из какого вы города') || historyText.includes('вы в бишкеке')
  const shortLocationAnswer = !/[?？]/.test(text) && normalized.split(/\s+/).length <= 5
  const deliveryQuestion = /достав|жеткир|отправ|привез/iu.test(text)
  return deliveryQuestion || (askedForCity && shortLocationAnswer)
}

export const ORDER_INTENT =
  /хочу\s+(?:заказать|купить|взять)|(?:как|где)\s+(?:заказать|купить|оформить)|закажу|заказать|оформить|оформляйте|оформляем|\bберу\b|возьму|можно\s+оформить|реквизит|куда\s+(?:скинуть|перевести|оплатить|платить)|как\s+оплатить|способ\s+оплаты|\bqr[\s-]?код/i

// Короткое согласие само по себе намерения не выражает («давайте» может
// относиться к чему угодно) — засчитываем его как заказ, только если прошлое
// сообщение бота было предложением оформить.
export const AFFIRMATIVE_ONLY =
  /^\s*(?:да|ага|угу|давай(?:те)?|ок(?:ей)?|хорошо|конечно|согласен|согласна|можно)[\s!.,)😊👍]*$/i
// Ответ «нет» на follow-up — единственный триггер скидки 13%: до follow-up
// скидку не предлагаем вовсе.
export const NEGATIVE_ONLY = /^\s*(?:нет|неа|не\s+хочу|не\s+буду|не\s+надо|откажусь|подумаю)[\s!.,)😔👎]*$/i
// ИИ формулирует призыв по-разному: «Оформить вам?», «Вам оформить доставку?»,
// «Оформить?» — привязка к точному порядку слов не работала.
export const ORDER_CTA_MARKER = /оформ\w*[^.!?]*\?/i

// Подводка перед фото — дословно как в Telegram (__main__.py).
export const RESULTS_INTRO = 'Вот результат нашего клиента до и после применения 👇'

// После блока результата скидку сразу не предлагаем — только вопрос «вам
// оформить?» через 5 минут молчания (followup.ts), а скидка — лишь если
// клиент на этот вопрос ответил отказом.
export const ORDER_CTA_FOLLOWUP_TEXT = 'Вам оформить? Пока есть в наличии.'
// Маркер-якорь для followup.ts: последняя запись в чате с этим текстом —
// сигнал «ждём 5 минут тишины клиента». Как только появляется любое следующее
// сообщение, якорь перестаёт быть последним и больше не триггерит.
export const FOLLOWUP_ANCHOR_TEXT = '[ожидание оформления]'

// Тот же набор, что уходит альбомом в Telegram. WhatsApp альбомов не
// поддерживает — шлём по одному.
export const RESULT_PHOTOS: readonly (readonly [string, string])[] = [['before_after.jpg', '']]

export const SCAM_DOUBT =
  /(?:вы\s+)?(?:точно\s+)?не\s+мошенник|мошенники\s*\?|(?:это\s+)?(?:точно\s+)?не\s+(?:обман|развод|скам|фейк)|без\s+обмана|(?:это\s+)?(?:все|всё)?\s*реально\s*(?:да|\?)|не\s+кин[её]те|вам\s+можно\s+доверять|можно\s+(?:ли\s+)?вам\s+верить|вы\s+настоящие/i

export const COMPLAINT =
  /развод|обман(?:ули)?|кинул|мошенник|верните\s+деньги|хочу\s+возврат|ужасн(?:о|ый|ая)|отвратительн|никогда\s+(?:больше\s+)?не\s+куплю|не\s+помогл|разочарован/i
export const COOPERATION =
  /сотрудничеств|оптом|\bопт\b|дистрибьютор|дилер|партн[её]р|реселлер|перепродаж|b2b|блогер/i

const READY_TO_BUY = /оформ(?:ить|ляйте)|заказ(?:ать|ываю)?|беру\b|покупаю\b|заброниру|резервиру/i
const INTEREST_CONFIRMED = /хочу\b|подходит|устраивает|интересует|готов\s+(?:взять|купить)|давайте/i
const NEED_IDENTIFIED =
  /полоск|отбелив|улыбк|зуб|цена|сколько\s+стоит|состав|инструкц|противопоказ|результат|скидк|доставк|коробк/i

/** Этап воронки по входящему тексту клиента. */
export function stageActionForInbound(text: string): string | null {
  if (COMPLAINT.test(text) || COOPERATION.test(text)) return 'non_standard_request'
  const value = text.replace(/ё/g, 'е')
  if (READY_TO_BUY.test(value)) return 'ready_to_buy'
  if (INTEREST_CONFIRMED.test(value)) return 'interest_confirmed'
  if (NEED_IDENTIFIED.test(value)) return 'need_identified'
  return null
}

export const RECEIPT_ACCEPTED =
  'Спасибо, чек получила! ✅ Заказ оформлен — передаю в доставку.\n\n' +
  'Курьер свяжется с вами перед выездом.'

export const RECEIPT_REJECTED =
  'Спасибо! Чек ушёл на проверку менеджеру — он свяжется с вами в ближайшее время. 😊'

export const QR_STORE_TEXT = '[QR оплаты]'
