// OpenAI: тексты, расшифровка речи, разбор картинок.

import { requestOrThrow } from '../../http'
import type { AiProvider, CompletionRequest, TranscribeRequest, VisionRequest } from '../../types'

const BASE = 'https://api.openai.com/v1'

function key(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${key()}` }
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
}

export const openai: AiProvider = {
  id: 'openai',
  kind: 'ai',
  title: 'OpenAI',

  isConfigured: () => Boolean(key()),

  async complete(req: CompletionRequest) {
    const data = await requestOrThrow<ChatResponse>(`${BASE}/chat/completions`, {
      headers: auth(),
      timeoutMs: 60_000,
      body: {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          ...(req.history ?? []),
          { role: 'user', content: req.message },
        ],
        max_tokens: req.maxTokens ?? 1024,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      },
    })
    return data.choices?.[0]?.message?.content?.trim() || null
  },

  async transcribe(req: TranscribeRequest) {
    // Multipart, а не JSON — поэтому мимо общего http-клиента.
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(req.audio)]), req.filename)
    form.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1')
    const response = await fetch(`${BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: auth(),
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`openai transcribe: HTTP ${response.status}`)
    const data = (await response.json()) as { text?: string }
    return data.text?.trim() || null
  },

  async vision(req: VisionRequest) {
    const data = await requestOrThrow<ChatResponse>(`${BASE}/chat/completions`, {
      headers: auth(),
      timeoutMs: 60_000,
      body: {
        model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: req.prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${req.mime};base64,${req.image.toString('base64')}` },
              },
            ],
          },
        ],
        max_tokens: 512,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      },
    })
    return data.choices?.[0]?.message?.content?.trim() || null
  },
}
