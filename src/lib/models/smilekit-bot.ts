// Типы настроек Telegram-бота Smilekit — ровно то, что отдаёт /internal/settings
// бота (smilekit_bot/api.py: effective_settings). Значения не переименовываем,
// чтобы форму CRM можно было сверить с ботом один в один.

/** Лимит символов на промпт — бот молча обрезает длиннее этого (smilekit_bot/api.py: MAX_PROMPT_LENGTH). */
export const SMILEKIT_BOT_PROMPT_LIMIT = 13000

export interface SmilekitBotSettings {
  managerPrompt: string
  managerPromptIsDefault: boolean
  supervisorPrompt: string
  supervisorPromptIsDefault: boolean
  model: string
  models: string[]
}

export type SmilekitBotSettingsInput = Pick<SmilekitBotSettings, 'managerPrompt' | 'supervisorPrompt' | 'model'>

export interface SmilekitLabMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Событие из живого журнала бота — /internal/events (storage.py: log_event/list_events). */
export interface SmilekitBotEvent {
  id: number
  chatId: number | null
  level: 'info' | 'warn' | 'error'
  stage: string
  event: string
  message: string
  details: Record<string, unknown> | null
  createdAt: number
}

/** Чат из списка «Диалоги» — /internal/chats (storage.py: list_chats). */
export interface SmilekitChatSummary {
  chatId: number
  lastAt: number
  lastText: string | null
  lastSender: SmilekitMessageSender | null
  paused: boolean
}

/** Кто написал сообщение: клиент, ИИ-бот или менеджер вручную из CRM. */
export type SmilekitMessageSender = 'client' | 'bot' | 'operator'

/** Сообщение переписки — /internal/chats/{id}/messages (storage.py: chat_messages). */
export interface SmilekitChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  kind: string
  createdAt: number
  sender: SmilekitMessageSender
}
