// Единая точка входа в ИИ: complete / transcribe / vision.
//
// Провайдер не выбирается в коде интеграции. Порядок задаётся переменной
// AI_PROVIDERS ("smilekit-bot,deepseek,openai,gemini"), а ядро берёт первого,
// который И настроен (есть ключ), И умеет нужную операцию. Отсюда два
// полезных свойства:
//   - смена провайдера — правка переменной, а не кода;
//   - «тексты у одного, расшифровка у другого» получается само собой:
//     DeepSeek не умеет аудио, и запрос уйдёт следующему в списке.
//
// Ошибка провайдера НЕ проваливается на следующего: молчаливая деградация на
// другую модель уже кусала этот проект (текст уходил не туда, где его ждали).
// Провайдер упал — это ошибка, её видно в логах, а не «странный ответ».

import { log } from '../logger'
import type { AiProvider, CompletionRequest, TranscribeRequest, VisionRequest } from '../types'
import { deepseek } from './providers/deepseek'
import { gemini } from './providers/gemini'
import { openai } from './providers/openai'
import { smilekitBot } from './providers/smilekit-bot'

const ALL: AiProvider[] = [smilekitBot, deepseek, openai, gemini]

const DEFAULT_ORDER = 'smilekit-bot,deepseek,openai,gemini'

export function providers(): AiProvider[] {
  const order = (process.env.AI_PROVIDERS || DEFAULT_ORDER)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return order.map((id) => ALL.find((provider) => provider.id === id)).filter(Boolean) as AiProvider[]
}

type Capability = 'complete' | 'transcribe' | 'vision'

/** Первый настроенный провайдер, умеющий эту операцию. */
export function pick(capability: Capability): AiProvider | null {
  return providers().find((provider) => provider.isConfigured() && typeof provider[capability] === 'function') ?? null
}

/** Кто что умеет прямо сейчас — для страницы состояния интеграций. */
export function aiStatus(): { id: string; title: string; configured: boolean; can: Capability[] }[] {
  return ALL.map((provider) => ({
    id: provider.id,
    title: provider.title,
    configured: provider.isConfigured(),
    can: (['complete', 'transcribe', 'vision'] as Capability[]).filter(
      (capability) => typeof provider[capability] === 'function'
    ),
  }))
}

export async function complete(req: CompletionRequest): Promise<string | null> {
  const provider = pick('complete')
  if (!provider) {
    log.error('ии: нет настроенного провайдера для текста (AI_PROVIDERS)')
    return null
  }
  return provider.complete!(req)
}

export async function transcribe(req: TranscribeRequest): Promise<string | null> {
  const provider = pick('transcribe')
  if (!provider) {
    log.error('ии: нет настроенного провайдера для расшифровки речи')
    return null
  }
  return provider.transcribe!(req)
}

export async function vision(req: VisionRequest): Promise<string | null> {
  const provider = pick('vision')
  if (!provider) {
    log.error('ии: нет настроенного провайдера для картинок')
    return null
  }
  return provider.vision!(req)
}

export const ai = { complete, transcribe, vision, pick, providers, status: aiStatus }
