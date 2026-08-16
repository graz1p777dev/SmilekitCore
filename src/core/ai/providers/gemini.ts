// Gemini: тексты, картинки и аудио — всё одним эндпоинтом generateContent,
// отличается только тип inlineData.

import { requestOrThrow } from '../../http'
import type { AiProvider, CompletionRequest, TranscribeRequest, VisionRequest } from '../../types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function key(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || undefined
}

function model(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.0-flash'
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

async function generate(parts: Part[], options: { json?: boolean; system?: string; maxTokens?: number } = {}) {
  // Ключ идёт заголовком, а не в query: в query он попадал бы в логи прокси.
  const data = await requestOrThrow<GenerateResponse>(`${BASE}/${model()}:generateContent`, {
    headers: { 'x-goog-api-key': key() as string },
    timeoutMs: 60_000,
    body: {
      contents: [{ role: 'user', parts }],
      ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        ...(options.json ? { responseMimeType: 'application/json' } : {}),
      },
    },
  })
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() || null
}

export const gemini: AiProvider = {
  id: 'gemini',
  kind: 'ai',
  title: 'Google Gemini',

  isConfigured: () => Boolean(key()),

  async complete(req: CompletionRequest) {
    // История склеивается в текст: у Gemini своя схема ролей, а ядру нужен
    // один и тот же контракт для всех провайдеров.
    const dialog = (req.history ?? []).map((item) => `${item.role === 'user' ? 'Клиент' : 'Бот'}: ${item.content}`)
    const text = dialog.length ? `${dialog.join('\n')}\nКлиент: ${req.message}` : req.message
    return generate([{ text }], { json: req.json, system: req.system, maxTokens: req.maxTokens })
  },

  async transcribe(req: TranscribeRequest) {
    return generate([
      { text: 'Расшифруй речь дословно. Верни только текст, без комментариев.' },
      { inlineData: { mimeType: 'audio/ogg', data: req.audio.toString('base64') } },
    ])
  },

  async vision(req: VisionRequest) {
    return generate(
      [{ text: req.prompt }, { inlineData: { mimeType: req.mime, data: req.image.toString('base64') } }],
      { json: req.json }
    )
  },
}
