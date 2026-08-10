'use server'

// Раздел «Диалоги»: переписка Telegram-бота Smilekit с клиентами.
// Всё через внутренний API бота (aiogram, Railway smilekit-bot) — секрет
// добавляется в smilekitBotFetch на сервере и в браузер не попадает.
//
// Ручной ответ менеджера автоматически ставит чат на паузу (бот молчит
// полностью — ни ответов, ни напоминаний), пока его не включат обратно.

import { smilekitBotFetch } from '@/lib/smilekit-bot-api'
import type { SmilekitChatMessage, SmilekitChatSummary } from '@/lib/models/smilekit-bot'

export type GetChatsResult =
  | { success: true; chats: SmilekitChatSummary[] }
  | { success: false; error: string }

export async function getBotChats(): Promise<GetChatsResult> {
  const result = await smilekitBotFetch<{ chats: SmilekitChatSummary[] }>('/internal/chats')
  if (!result.ok) return { success: false, error: result.error }
  return { success: true, chats: result.data.chats }
}

export type GetChatMessagesResult =
  | { success: true; messages: SmilekitChatMessage[]; paused: boolean }
  | { success: false; error: string }

export async function getBotChatMessages(chatId: number): Promise<GetChatMessagesResult> {
  const result = await smilekitBotFetch<{ messages: SmilekitChatMessage[]; paused: boolean }>(
    `/internal/chats/${chatId}/messages`
  )
  if (!result.ok) return { success: false, error: result.error }
  return { success: true, messages: result.data.messages, paused: result.data.paused }
}

export type SimpleResult = { success: true } | { success: false; error: string }

export async function sendOperatorMessage(chatId: number, text: string): Promise<SimpleResult> {
  const trimmed = text.trim()
  if (!trimmed) return { success: false, error: 'Введите сообщение' }
  const result = await smilekitBotFetch<{ paused: boolean }>(`/internal/chats/${chatId}/message`, {
    method: 'POST',
    body: { text: trimmed },
  })
  if (!result.ok) return { success: false, error: result.error }
  return { success: true }
}

export async function pauseBotChat(chatId: number): Promise<SimpleResult> {
  const result = await smilekitBotFetch<{ paused: boolean }>(`/internal/chats/${chatId}/pause`, {
    method: 'POST',
    body: {},
  })
  if (!result.ok) return { success: false, error: result.error }
  return { success: true }
}

export async function resumeBotChat(chatId: number): Promise<SimpleResult> {
  const result = await smilekitBotFetch<{ paused: boolean }>(`/internal/chats/${chatId}/resume`, {
    method: 'POST',
    body: {},
  })
  if (!result.ok) return { success: false, error: result.error }
  return { success: true }
}
