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

// ─── Аварийный выключатель бота amoCRM (WhatsApp-канал) ───
// Флаг integrations.amoCRM.is_active читается на каждое входящее сообщение
// (src/lib/amocrm/bot-reply.ts): выключен — бот молчит мгновенно, история
// и сделки продолжают вестись.

import { createAdminClient } from '@/lib/supabase/admin'

export async function getAmoBotEnabled(): Promise<{ success: true; enabled: boolean } | { success: false; error: string }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('integrations').select('is_active').eq('name', 'amoCRM').maybeSingle()
  if (error) return { success: false, error: error.message }
  return { success: true, enabled: Boolean((data as { is_active?: boolean } | null)?.is_active) }
}

export async function setAmoBotEnabled(enabled: boolean): Promise<SimpleResult> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('integrations')
    .update({ is_active: enabled, updated_at: new Date().toISOString() })
    .eq('name', 'amoCRM')
  if (error) return { success: false, error: error.message }
  return { success: true }
}
