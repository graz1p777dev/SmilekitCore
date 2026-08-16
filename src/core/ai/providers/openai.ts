// OpenAI: тексты, расшифровка речи, разбор картинок.

import { requestOrThrow } from '../../http'
import { vars } from '../../variables'
import type { AiProvider, CompletionRequest, TranscribeRequest, VisionRequest } from '../../types'

const BASE = 'https://api.openai.com/v1'

async function auth(): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await vars.requireValue('OPENAI_API_KEY')}` }
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
}

export const openai: AiProvider = {
  id: 'openai',
  kind: 'ai',
  title: 'OpenAI',
  env: {
    OPENAI_API_KEY: { description: 'ключ API OpenAI', required: true },
    OPENAI_MODEL: { description: 'модель для текста, по умолчанию gpt-4o-mini' },
    OPENAI_TRANSCRIPTION_MODEL: { description: 'модель расшифровки речи, по умолчанию whisper-1' },
    OPENAI_VISION_MODEL: { description: 'модель для картинок, по умолчанию как OPENAI_MODEL' },
  },

  isConfigured: () => Boolean(vars.snapshot('OPENAI_API_KEY')),

  async complete(req: CompletionRequest) {
    const data = await requestOrThrow<ChatResponse>(`${BASE}/chat/completions`, {
      headers: await auth(),
      timeoutMs: 60_000,
      body: {
        model: (await vars.get('OPENAI_MODEL')) || 'gpt-4o-mini',
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
    form.append('model', (await vars.get('OPENAI_TRANSCRIPTION_MODEL')) || 'whisper-1')
    const response = await fetch(`${BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: await auth(),
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`openai transcribe: HTTP ${response.status}`)
    const data = (await response.json()) as { text?: string }
    return data.text?.trim() || null
  },

  async vision(req: VisionRequest) {
    const data = await requestOrThrow<ChatResponse>(`${BASE}/chat/completions`, {
      headers: await auth(),
      timeoutMs: 60_000,
      body: {
        model: (await vars.get('OPENAI_VISION_MODEL')) || (await vars.get('OPENAI_MODEL')) || 'gpt-4o-mini',
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
