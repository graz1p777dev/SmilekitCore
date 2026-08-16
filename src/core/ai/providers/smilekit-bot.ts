// Telegram-бот SmileKit как провайдер ИИ.
//
// Это не «ещё одна модель», а действующий мозг продаж: у бота лежат промпты
// менеджера и супервизора, и именно он отвечает клиентам в Telegram. Чтобы
// WhatsApp не разъезжался с Telegram по формулировкам, ответы берутся у него
// же — /internal/lab. Поэтому он и стоит первым в AI_PROVIDERS по умолчанию.
//
// Своей модели у провайдера нет: он ходит в бота, а бот уже сам выбирает
// DeepSeek/OpenAI. Прямые провайдеры ниже по списку — запасной путь на случай,
// если бот недоступен.

import { request } from '../../http'
import type { AiProvider, CompletionRequest, TranscribeRequest } from '../../types'

function base(): string | undefined {
  return process.env.SMILEKIT_BOT_API_URL?.replace(/\/$/, '') || undefined
}

function token(): string | undefined {
  return process.env.SMILEKIT_BOT_INTERNAL_TOKEN?.trim() || undefined
}

async function call<T>(path: string, body: unknown): Promise<T | null> {
  const url = base()
  const secret = token()
  if (!url || !secret) return null
  const result = await request<T>(`${url}${path}`, {
    method: 'POST',
    headers: { 'x-internal-token': secret },
    body,
    timeoutMs: 60_000,
  })
  if (!result.ok) throw new Error(`smilekit-bot ${path}: ${result.error}`)
  return result.data
}

export const smilekitBot: AiProvider = {
  id: 'smilekit-bot',
  kind: 'ai',
  title: 'Бот SmileKit (/internal/lab)',

  isConfigured: () => Boolean(base() && token()),

  async complete(req: CompletionRequest) {
    const data = await call<{ reply?: string }>('/internal/lab', {
      message: req.message,
      history: req.history ?? [],
    })
    return data?.reply?.trim() || null
  },

  async transcribe(req: TranscribeRequest) {
    const data = await call<{ transcript?: string }>('/internal/transcribe', {
      audioBase64: req.audio.toString('base64'),
      filename: req.filename,
    })
    return data?.transcript?.trim() || null
  },
}

/**
 * Проверка чека штатным эндпоинтом бота — те же критерии, что в Telegram
 * (сумма, получатель, дата, «похоже ли на скриншот перевода»). Живёт рядом с
 * провайдером, но в общий интерфейс не входит: это доменная операция SmileKit,
 * а не способность модели.
 */
export interface ReceiptCheck {
  is_real_receipt_screenshot: boolean
  amount_ok: boolean
  recipient_ok: boolean
  date_ok: boolean
}

export async function verifyReceiptViaBot(
  image: Buffer,
  today: string,
  mime: string
): Promise<ReceiptCheck | null> {
  return call<ReceiptCheck>('/internal/verify_receipt', {
    imageBase64: image.toString('base64'),
    today,
    kind: mime.includes('pdf') ? 'pdf' : 'image',
    mime,
  })
}

/** Отправка заказа в группу доставки Telegram — тоже домен бота, не модели. */
export async function pushDeliveryViaBot(payload: Record<string, unknown>): Promise<void> {
  await call('/internal/push_delivery', payload)
}
