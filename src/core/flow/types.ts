// Модель сценария, который владелец собирает на канве.
//
// Одна ветка = «если условия совпали → выполнить действия по порядку».
// Ветки упорядочены: первая совпавшая выигрывает — та же логика, что у
// скрипта продаж в коде, только редактируется из браузера.
//
// Намеренно НЕ граф общего назначения: никаких циклов, слияний и ветвлений
// внутри ветки. Такой моделью пользуются менеджеры, а не программисты, и
// линейная цепочка действий читается без обучения.

import type { Chat, DealRef, HistoryItem, Logger } from '../types'

export type ConditionField = 'text' | 'last_bot_text' | 'history' | 'author_name'

export type ConditionOp = 'contains' | 'not_contains' | 'equals' | 'matches' | 'is_first_message'

export interface FlowCondition {
  field: ConditionField
  op: ConditionOp
  value: string
}

export type FlowAction =
  /** Ответить текстом. Поддерживает {{name}}, {{phone}}, {{text}}. */
  | { type: 'reply'; text: string }
  /** Отправить файл по ссылке: фото результата, QR, документ. */
  | { type: 'media'; url: string; fileName: string; caption?: string; voice?: boolean }
  /** Пауза. Дальнейшие действия выполнит планировщик. */
  | { type: 'wait'; minutes: number; cancelIfReplied?: boolean }
  /** Ответ моделью — когда готового текста нет. */
  | { type: 'ai_reply'; instruction?: string }
  /** Двинуть этап сделки. */
  | { type: 'stage'; action: string }
  /** Уведомить менеджеров в CRM. */
  | { type: 'notify'; title: string }
  /** Дёрнуть внешнюю систему. */
  | { type: 'webhook'; url: string }

export type FlowActionType = FlowAction['type']

export interface FlowRule {
  id: string
  channel: string
  name: string
  enabled: boolean
  /** Приоритет: меньше — раньше. Первая совпавшая ветка выигрывает. */
  position: number
  conditions: FlowCondition[]
  actions: FlowAction[]
  /** Не продолжать встроенный скрипт продаж после этой ветки. */
  stopAfter: boolean
  /** Координаты узлов на канве — оформление, на выполнение не влияет. */
  layout: Record<string, { x: number; y: number }>
}

/**
 * Контекст выполнения действий. Он же нужен планировщику при возобновлении
 * после паузы — поэтому здесь нет ничего, что живёт только во время
 * обработки входящего сообщения.
 */
export interface FlowExecutionContext {
  channel: string
  chatId: string
  chat: Chat
  /** Текст клиента, из-за которого ветка сработала. */
  text: string
  authorName: string | null
  history: HistoryItem[]
  deal: DealRef
  log: Logger
  dryRun: boolean
}
