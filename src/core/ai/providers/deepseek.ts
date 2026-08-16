// DeepSeek: только тексты (аудио и картинок у него нет).
//
// ⚠️ thinking выключен принудительно. У DeepSeek V4 рассуждения включены по
// умолчанию и способны съесть весь max_tokens до финального ответа — content
// приходит пустым, особенно на коротких и JSON-ответах. Этот баг уже доходил
// до прода SmileKit: клиент получил заглушку вместо ответа. Если когда-нибудь
// понадобятся развёрнутые рассуждения — включать осознанно и отдельным полем
// запроса, но не по умолчанию.

import { requestOrThrow } from '../../http'
import { vars } from '../../variables'
import type { AiProvider, CompletionRequest } from '../../types'

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
}

export const deepseek: AiProvider = {
  id: 'deepseek',
  kind: 'ai',
  title: 'DeepSeek',
  env: {
    DEEPSEEK_API_KEY: { description: 'ключ API DeepSeek', required: true },
    DEEPSEEK_MODEL: { description: 'модель, по умолчанию deepseek-chat' },
    DEEPSEEK_BASE_URL: { description: 'адрес API, по умолчанию https://api.deepseek.com' },
  },

  isConfigured: () => Boolean(vars.snapshot('DEEPSEEK_API_KEY')),

  async complete(req: CompletionRequest) {
    const base = ((await vars.get('DEEPSEEK_BASE_URL')) || 'https://api.deepseek.com').replace(/\/$/, '')
    const data = await requestOrThrow<ChatResponse>(`${base}/chat/completions`, {
      headers: { authorization: `Bearer ${await vars.requireValue('DEEPSEEK_API_KEY')}` },
      timeoutMs: 60_000,
      body: {
        model: (await vars.get('DEEPSEEK_MODEL')) || 'deepseek-chat',
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          ...(req.history ?? []),
          { role: 'user', content: req.message },
        ],
        max_tokens: req.maxTokens ?? 1024,
        thinking: { type: 'disabled' },
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      },
    })
    return data.choices?.[0]?.message?.content?.trim() || null
  },
}
