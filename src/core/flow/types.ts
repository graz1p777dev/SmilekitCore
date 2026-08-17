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
  /** Ответить текстом. Поддерживает подстановки {{переменная}}. */
  | { type: 'reply'; text: string }
  /** Ответить сохранённым шаблоном — текст правится в одном месте. */
  | { type: 'template'; templateId: string }
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

/**
 * Защита от дублей: сколько раз ветка вправе сработать в одном чате.
 * off — без ограничений; once_per_chat — ровно один раз за всю переписку;
 * cooldown — не чаще, чем раз в N минут.
 */
export type DedupeMode = 'off' | 'once_per_chat' | 'cooldown'

export interface FlowDedupe {
  mode: DedupeMode
  /** Только для cooldown. */
  minutes?: number
}

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
  dedupe: FlowDedupe
  /** Координаты узлов на канве — оформление, на выполнение не влияет. */
  layout: Record<string, { x: number; y: number }>
}

/** Именованный текст: ветки ссылаются на него, а не копируют формулировку. */
export interface FlowTemplate {
  id: string
  name: string
  text: string
}

/**
 * Откуда переменная берёт значение.
 *
 * ai — единственный источник, который стоит денег и времени: модель
 * заполняет переменную по своему промпту прямо во время ответа клиенту.
 */
export type VariableSource =
  | 'date'
  | 'time'
  | 'datetime'
  | 'client_name'
  | 'client_phone'
  | 'message'
  | 'static'
  | 'ai'

export interface FlowVariable {
  id: string
  /** Имя подстановки: {{город}}. */
  name: string
  source: VariableSource
  /** Что модель должна положить в переменную (source = 'ai'). */
  aiPrompt: string | null
  /** Фиксированное значение (source = 'static'). */
  value: string | null
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
