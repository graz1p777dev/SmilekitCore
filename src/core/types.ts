// Контракты ядра. Здесь описано ВСЁ, что интеграция обязана предоставить,
// и всё, что ядро даёт ей взамен. Файл читается как оглавление системы —
// если новый тип не нужен ни одной интеграции, ему здесь не место.
//
// Правило разделения: ядро знает про «чат», «сообщение», «сделку» и «ИИ»;
// оно НЕ знает про Green API, amoCRM, WhatsApp и Telegram. Всё, что знает
// про конкретного провайдера, живёт в src/integrations/<id>/.

import type { DealSource } from '@/types'

export type IntegrationKind = 'channel' | 'ai' | 'module'

// ─── Сообщения ───────────────────────────────────────────────────────────

export type MessageKind = 'text' | 'voice' | 'image' | 'file'

/** Входящее от клиента — уже разобранное из формата провайдера. */
export interface InboundMessage {
  /** id сообщения у провайдера: ключ идемпотентности, вебхуки повторяются. */
  providerMessageId: string
  /** Адрес чата в канонической форме канала (для WhatsApp — голый номер). */
  chatId: string
  authorName: string | null
  text: string
  kind: MessageKind
  mediaUrl: string | null
}

export interface OutboundMedia {
  url: string
  fileName: string
  caption?: string
  /** Голосовой «пузырь», а не файл-вложение (WhatsApp: только OGG/Opus). */
  voice?: boolean
}

/** Исходящее. Ядро само решает, что записать в историю и что отправить. */
export interface OutboundMessage {
  text?: string
  media?: OutboundMedia
  /** Суффикс id в истории. По умолчанию — порядковый номер в пачке. */
  key?: string
  /** Записать в историю, но не отправлять: маркеры, якоря планировщиков. */
  storeOnly?: boolean
  /** Что показать в истории вместо text (для медиа: «[QR оплаты]»). */
  storeText?: string
  /** Пауза перед отправкой, мс — имитация набора текста человеком. */
  delayMs?: number
}

// ─── Транспорт канала ────────────────────────────────────────────────────

/**
 * Единственное, что канал обязан уметь физически: отправить сообщение.
 * Ошибку бросает наружу — ядро откатит запись в истории, чтобы в переписке
 * не осталось сообщения, которого клиент не получил.
 */
export interface ChannelTransport {
  send(chatId: string, message: OutboundMessage): Promise<void>
}

/** Общие предохранители, одинаковые для всех каналов. */
export interface ChannelGuards {
  /** Запись в таблице integrations, служащая аварийным выключателем бота. */
  killSwitch?: string
  /** Переменная со списком chatId для обкатки («пока отвечаем только своим»). */
  allowlistEnv?: string
  /** Уважать campaign_opt_outs.block_bot_replies. */
  respectOptOut?: boolean
}

// ─── Разговор ────────────────────────────────────────────────────────────

export interface HistoryItem {
  role: 'user' | 'assistant'
  content: string
  sender: string
}

/**
 * Чат — рабочая поверхность интеграции. Всё, что делает бот, делается через
 * него: send() уже содержит проверку предохранителей, запись в историю,
 * откат при ошибке транспорта и защиту от собственного эха.
 */
export interface Chat {
  readonly id: string
  readonly channel: string
  /** Отправить (или только записать при storeOnly). false — не отправлено. */
  send(message: OutboundMessage): Promise<boolean>
  /** Можно ли сейчас отвечать: рубильник, менеджер, отписка, allowlist. */
  canReply(): Promise<boolean>
  /** Одноразовое событие на чат: true только первому вызвавшему. */
  claim(key: string, text?: string): Promise<boolean>
  history(limit?: number): Promise<HistoryItem[]>
  /** Текст последней реплики бота — по нему политики понимают контекст. */
  lastBotText(): Promise<string>
  /** Когда мы в последний раз отправляли ровно такой текст (null — никогда). */
  sentAt(text: string): Promise<Date | null>
}

export interface DealRef {
  externalKey: string
  /** Двинуть этап сделки: 'need_identified' | 'order' | ... */
  advance(action: string): Promise<void>
}

/** Всё, что политика получает на вход. Больше ей ничего не нужно. */
export interface DialogContext<TConfig = unknown> {
  message: InboundMessage
  chat: Chat
  history: HistoryItem[]
  config: TConfig
  deal: DealRef
  log: Logger
  /** Лаборатория: не дёргать провайдера и не плодить настоящие сделки. */
  dryRun: boolean
}

// ─── Интеграции ──────────────────────────────────────────────────────────

export interface ChannelIntegration<TConfig = unknown> {
  id: string
  kind: 'channel'
  title: string
  /**
   * Префикс id сообщений в общей истории ('ga' → 'ga:<providerMessageId>').
   * Разводит каналы в одной таблице без отдельной миграции на канал.
   */
  prefix: string
  /** Источник сделки в CRM. */
  source: DealSource
  transport: ChannelTransport
  config?: ConfigHandle<TConfig>
  guards?: ChannelGuards
  /** Расшифровывать голосовые до политики (по умолчанию да). */
  transcribeVoice?: boolean
  /** Ключ сделки для чата. По умолчанию `<id>:<chatId>`. */
  externalKey?(chatId: string): Promise<string> | string
  /**
   * Ранняя ветка до основного сценария (картинка-чек, команда).
   * Вернула true — ядро на этом останавливается.
   */
  intercept?(ctx: DialogContext<TConfig>): Promise<boolean>
  /** Что ответить клиенту. Пустой массив — молчим. */
  reply(ctx: DialogContext<TConfig>): Promise<OutboundMessage[]>
  /** Действие этапа сделки по тексту клиента. */
  stageAction?(text: string): string | null
}

export interface ModuleIntegration<TConfig = unknown> {
  id: string
  kind: 'module'
  title: string
  config?: ConfigHandle<TConfig>
  /** Подписки на события ядра — вызывается один раз при регистрации. */
  setup?(): void
}

export type Integration = ChannelIntegration<never> | ModuleIntegration<never> | AiProvider

// ─── ИИ ──────────────────────────────────────────────────────────────────

export interface CompletionRequest {
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  system?: string
  /** Просить строгий JSON (у провайдеров это разные поля). */
  json?: boolean
  maxTokens?: number
}

export interface TranscribeRequest {
  audio: Buffer
  filename: string
}

export interface VisionRequest {
  image: Buffer
  mime: string
  prompt: string
  json?: boolean
}

/**
 * Провайдер ИИ. Ни один метод не обязателен — ядро выбирает первого
 * провайдера из AI_PROVIDERS, который настроен И умеет нужную операцию.
 * Так «только транскрипция у одного, тексты у другого» не требует кода.
 */
export interface AiProvider {
  id: string
  kind: 'ai'
  title: string
  isConfigured(): boolean
  complete?(req: CompletionRequest): Promise<string | null>
  transcribe?(req: TranscribeRequest): Promise<string | null>
  vision?(req: VisionRequest): Promise<string | null>
}

// ─── Служебное ───────────────────────────────────────────────────────────

export interface Logger {
  info(message: string, ...details: unknown[]): void
  warn(message: string, ...details: unknown[]): void
  error(message: string, ...details: unknown[]): void
  /** Дочерний логгер: scope склеивается через ':'. */
  child(scope: string): Logger
}

/** Описание переменной окружения — попадает в /docs и в проверку старта. */
export interface EnvSpec {
  description: string
  required?: boolean
}

export interface ConfigHandle<T> {
  /** Ключ в settings.extra. */
  readonly key: string
  readonly env: Record<string, EnvSpec>
  get(): Promise<T>
  save(patch: Partial<T>): Promise<{ ok: true } | { ok: false; error: string }>
  /** Значение переменной окружения из объявленных в env. */
  envValue(name: string): string | undefined
  /** Незаданные обязательные переменные — для страницы состояния интеграций. */
  missingEnv(): string[]
}
