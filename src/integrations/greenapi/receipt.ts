// Картинка от клиента — это почти всегда чек об оплате.
//
// Ветка стоит ДО скрипта продаж (intercept в ядре): модель картинку не видит
// и, не зная об оплате, предлагала предоплату уже оплатившему клиенту.
//
// Чек, не прошедший проверку, всё равно доходит до менеджера — с пометкой
// «проверить руками». Потерять оплату страшнее, чем показать лишний чек.

import { emit, fetchBinary, type DialogContext } from '@/core'
import { crm } from '@/core'
import { sendGreenApiDeliveryGroupFile } from '@/lib/greenapi/client'
import { pushDeliveryViaBot, verifyReceiptViaBot, type ReceiptCheck } from '@/core/ai/providers/smilekit-bot'
import { type GreenApiConfig } from './config'
import * as script from './script'

const MAX_RECEIPT_BYTES = 20 * 1024 * 1024

/**
 * Дата, с которой сверяется чек — день отправки QR, а не «сегодня»: клиент
 * получает реквизиты вечером и платит после полуночи, и по «сегодня» такой
 * чек считался бы вчерашним и отклонялся.
 */
async function referenceDate(ctx: DialogContext<GreenApiConfig>): Promise<string> {
  const qrSentAt = await ctx.chat.sentAt(script.QR_STORE_TEXT)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(qrSentAt ?? new Date())
}

export async function handleReceipt(ctx: DialogContext<GreenApiConfig>): Promise<boolean> {
  const { message, chat, config, deal, log } = ctx
  if (message.kind !== 'image' || !message.mediaUrl) return false

  let check: ReceiptCheck | null = null
  let image: Buffer | null = null
  try {
    const file = await fetchBinary(message.mediaUrl, MAX_RECEIPT_BYTES)
    image = file.bytes
    check = await verifyReceiptViaBot(file.bytes, await referenceDate(ctx), file.mime)
  } catch (error) {
    log.error('проверка чека не удалась', error)
  }

  // «Не смогли проверить» и «чек плохой» — разные вещи. Без этого различия
  // менеджер видел в группе четыре ложные причины несовпадения на идеальном
  // чеке (так падает verify_receipt при сбое: все критерии false).
  const checkUnavailable =
    !check || !(check.is_real_receipt_screenshot || check.amount_ok || check.recipient_ok || check.date_ok)
  const verified = Boolean(check?.is_real_receipt_screenshot && check.amount_ok && check.recipient_ok && check.date_ok)

  const sent = await chat.send({
    key: 'receipt',
    text: verified ? script.RECEIPT_ACCEPTED : script.RECEIPT_REJECTED,
  })
  if (!sent) return true

  // Адрес клиент обычно пишет подписью к чеку или соседним сообщением —
  // собираем последние свои реплики, чтобы менеджеру не лезть в переписку.
  const clientNotes = [...ctx.history.filter((item) => item.role === 'user').slice(-4), { content: message.text }]
    .map((item) => item.content)
    .filter(Boolean)
    .join(' | ')

  const status = verified
    ? 'Чек проверен'
    : checkUnavailable
      ? 'Чек не проверен автоматически'
      : 'Чек не прошёл проверку'

  await crm.createOrder({
    externalKey: `${deal.externalKey}:order:${message.providerMessageId}`,
    dealExternalKey: deal.externalKey,
    source: 'manual',
    customerName: message.authorName,
    customerPhone: message.chatId,
    quantity: 1,
    totalAmount: null,
    currency: 'KGS',
    summary:
      `${status} (WhatsApp)` +
      (message.text ? `\nАдрес: ${message.text}` : '') +
      `\n[media]${message.mediaUrl}`,
  })

  if (image) {
    try {
      await pushDeliveryViaBot({
        imageBase64: image.toString('base64'),
        kind: 'image',
        source: 'WhatsApp',
        customerName: message.authorName ?? null,
        customerPhone: message.chatId,
        address: message.text || null,
        orderSummary: clientNotes.slice(0, 350),
        mismatchReasons: verified
          ? null
          : checkUnavailable
            ? ['автопроверка недоступна — проверьте чек глазами']
            : [
                !check?.is_real_receipt_screenshot ? 'не похоже на скриншот перевода' : null,
                check && !check.amount_ok ? 'сумма не совпадает' : null,
                check && !check.recipient_ok ? 'получатель не совпадает' : null,
                check && !check.date_ok ? 'дата не совпадает' : null,
              ].filter(Boolean),
      })
    } catch (error) {
      log.error('отправка заказа в группу Telegram не прошла', error)
    }
  }

  if (config.deliveryGroupId) {
    // Промпт из настроек — свободный текст, {name}/{phone}/{address}
    // заменяются значениями заказа.
    const caption = (config.deliveryPrompt || 'Новый заказ ({name}, {phone})\nАдрес: {address}')
      .replaceAll('{name}', message.authorName || '—')
      .replaceAll('{phone}', message.chatId)
      .replaceAll('{address}', message.text || '—')
    try {
      await sendGreenApiDeliveryGroupFile(config.deliveryGroupId, {
        urlFile: message.mediaUrl,
        fileName: 'receipt.jpg',
        caption,
      })
    } catch (error) {
      log.error('отправка чека в группу WhatsApp не прошла', error)
    }
  }

  // Дальше канал не решает ничего: списание остатка и дублирование заказа во
  // внешние системы — подписчики этого события (src/integrations/inventory,
  // src/integrations/outbound-webhooks). Их можно выключить, не трогая канал.
  await emit('order.created', {
    channel: 'greenapi',
    chatId: message.chatId,
    externalKey: deal.externalKey,
    verified,
    customerName: message.authorName,
    customerPhone: message.chatId,
    address: message.text || null,
    receiptUrl: message.mediaUrl,
  })

  await deal.advance('order')
  return true
}
