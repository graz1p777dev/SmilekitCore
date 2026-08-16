// Публичный вход в ядро. Интеграции импортируют только отсюда:
//
//   import { defineChannel, ai, crm, on } from '@/core'
//
// Если интеграции понадобился внутренний файл ядра напрямую — это сигнал,
// что в контракте чего-то не хватает: лучше добавить сюда, чем протянуть
// зависимость мимо границы.

export { defineConfig, envList, listConfigs, requireEnv } from './config'
export { emit, on, type CoreEvents } from './events'
export { fetchBinary, request, requestOrThrow, type HttpResult, type RequestOptions } from './http'
export { createLogger, log } from './logger'
export { findStaleAnchors, type StaleAnchor } from './conversation'
export { serial, sleep } from './queue'
export { getChannel, listChannels, listModules, register, requireChannel } from './registry'
export { ai } from './ai'
export { crm } from './crm'
export { chatOf, receive, receiveOperatorMessage, send, type ReceiveOptions } from './messaging'
export { canReply, killSwitchOn, managerControlsChat } from './guards'

import type { ChannelIntegration, ModuleIntegration } from './types'

export type {
  ChannelGuards,
  ChannelIntegration,
  ChannelTransport,
  Chat,
  CompletionRequest,
  ConfigHandle,
  DealRef,
  DialogContext,
  HistoryItem,
  InboundMessage,
  Logger,
  MessageKind,
  ModuleIntegration,
  OutboundMedia,
  OutboundMessage,
  TranscribeRequest,
  VisionRequest,
} from './types'

/** Объявление канала. Единственное отличие от литерала — проставленный kind. */
export function defineChannel<TConfig>(
  spec: Omit<ChannelIntegration<TConfig>, 'kind'>
): ChannelIntegration<TConfig> {
  return { ...spec, kind: 'channel' }
}

/** Объявление модуля: слушает события ядра, своего транспорта не имеет. */
export function defineModule<TConfig>(spec: Omit<ModuleIntegration<TConfig>, 'kind'>): ModuleIntegration<TConfig> {
  return { ...spec, kind: 'module' }
}
