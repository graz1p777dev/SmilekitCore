// Разбор вебхука Green API → InboundMessage ядра.
//
// Вся «формоспецифичность» провайдера заканчивается здесь: дальше ядро видит
// обычное сообщение с текстом, типом и ссылкой на вложение.

import { phoneFromGreenApiChatId } from '@/lib/greenapi/client'
import type { InboundMessage, MessageKind } from '@/core'

export interface GreenApiWebhookBody {
  typeWebhook: string
  idMessage?: string
  senderData?: { chatId?: string; sender?: string; senderName?: string; chatName?: string }
  messageData?: {
    typeMessage?: string
    textMessageData?: { textMessage?: string }
    extendedTextMessageData?: { text?: string }
    fileMessageData?: { downloadUrl?: string; caption?: string; mimeType?: string }
  }
}

const VOICE_TYPES = new Set(['voice', 'audio', 'audioMessage'])
const IMAGE_TYPES = new Set(['image', 'imageMessage', 'documentMessage'])

export function isAuthorized(authorization: string | null): boolean {
  const expected = process.env.GREENAPI_WEBHOOK_TOKEN
  return Boolean(expected) && authorization === `Bearer ${expected}`
}

function extractText(body: GreenApiWebhookBody): string {
  const data = body.messageData
  return (
    data?.textMessageData?.textMessage ??
    data?.extendedTextMessageData?.text ??
    data?.fileMessageData?.caption ??
    ''
  ).trim()
}

function kindOf(typeMessage: string, hasMedia: boolean): MessageKind {
  if (VOICE_TYPES.has(typeMessage)) return 'voice'
  if (IMAGE_TYPES.has(typeMessage)) return 'image'
  return hasMedia ? 'file' : 'text'
}

export type ParsedWebhook =
  | { type: 'inbound'; message: InboundMessage }
  /** Отправлено с самого телефона — это живой менеджер, не мы. */
  | { type: 'operator'; message: InboundMessage }
  | { type: 'ignore' }

export function parseWebhook(body: GreenApiWebhookBody): ParsedWebhook {
  const chatId = body.senderData?.chatId
  const providerMessageId = body.idMessage
  if (!chatId || !providerMessageId) return { type: 'ignore' } // служебные события

  const text = extractText(body)
  const mediaUrl = body.messageData?.fileMessageData?.downloadUrl ?? null
  const message: InboundMessage = {
    providerMessageId,
    chatId: phoneFromGreenApiChatId(chatId),
    authorName: body.senderData?.senderName || body.senderData?.chatName || null,
    text,
    kind: kindOf(body.messageData?.typeMessage ?? '', Boolean(mediaUrl)),
    mediaUrl,
  }

  if (body.typeWebhook === 'incomingMessageReceived') {
    // Голосовые и картинки приходят без текста, но обрабатываются
    // (расшифровка речи и проверка чека) — отбрасываем только то, где нет
    // ни текста, ни файла.
    if (!text && !mediaUrl) return { type: 'ignore' }
    return { type: 'inbound', message }
  }

  // outgoingAPIMessageReceived сюда не попадает намеренно: через API шлём
  // только мы, и собственное эхо бота раньше записывалось как менеджер —
  // бот замолкал в чате посреди своей же отправки.
  if (body.typeWebhook === 'outgoingMessageReceived' && text) {
    return { type: 'operator', message }
  }

  return { type: 'ignore' }
}
