import { NextRequest, NextResponse } from 'next/server'
import { phoneFromGreenApiChatId } from '@/lib/greenapi/client'
import { processInboundGreenApiMessage, registerOutgoingGreenApiMessage } from '@/lib/greenapi/bot-reply'

// Green API шлёт Authorization: Bearer <webhookUrlToken> (см. setGreenApiWebhook).
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.GREENAPI_WEBHOOK_TOKEN
  const header = request.headers.get('authorization') || ''
  return Boolean(expected) && header === `Bearer ${expected}`
}

interface GreenApiWebhookBody {
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

function extractText(body: GreenApiWebhookBody): string {
  const data = body.messageData
  return (
    data?.textMessageData?.textMessage ??
    data?.extendedTextMessageData?.text ??
    data?.fileMessageData?.caption ??
    ''
  ).trim()
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as GreenApiWebhookBody | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const chatId = body.senderData?.chatId
  const providerMessageId = body.idMessage
  if (!chatId || !providerMessageId) return NextResponse.json({ ok: true }) // служебные события без сообщения

  const phone = phoneFromGreenApiChatId(chatId)
  const typeMessage = body.messageData?.typeMessage ?? ''
  const text = extractText(body)
  const authorName = body.senderData?.senderName || body.senderData?.chatName || null

  if (body.typeWebhook === 'incomingMessageReceived') {
    if (!text && typeMessage !== 'audioMessage') return NextResponse.json({ ok: true })
    void processInboundGreenApiMessage({
      providerMessageId,
      chatId: phone,
      authorName,
      text,
      messageType: typeMessage,
      mediaUrl: body.messageData?.fileMessageData?.downloadUrl ?? null,
    })
  } else if (body.typeWebhook === 'outgoingMessageReceived' || body.typeWebhook === 'outgoingAPIMessageReceived') {
    // Сообщение от менеджера напрямую из WhatsApp (не через нашего бота).
    if (text) {
      void registerOutgoingGreenApiMessage({ providerMessageId, chatId: phone, authorName, text })
    }
  }

  return NextResponse.json({ ok: true })
}
