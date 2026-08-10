import { createAdminClient } from '@/lib/supabase/admin'
import { getAmoChatHistory } from '@/lib/amocrm/chat'

const BOT_ECHO_WINDOW_MS = 15 * 60_000
const MANAGER_REPLY_PLACEHOLDER = '[ответ менеджера]'

/**
 * Подтягивает живую историю amojo в нашу таблицу. Это делает видимыми
 * сообщения, которые появились до регистрации вебхука, и позволяет боту
 * заметить, что в диалоге уже работал менеджер.
 */
export async function syncAmoChatHistory(chatId: string, leadId: string | null = null): Promise<void> {
  const remote = await getAmoChatHistory(chatId, 200)
  if (!remote.length) return

  const supabase = createAdminClient()
  const { data: local, error } = await supabase
    .from('amocrm_messages')
    .select('amo_message_id, lead_id, sender, text, created_at')
    .eq('chat_id', chatId)
    .order('id')
  if (error) throw new Error(`amo history local read: ${error.message}`)

  const localByMessageId = new Map(
    (local ?? []).map((row) => [String(row.amo_message_id), row] as const)
  )
  const existingIds = new Set(localByMessageId.keys())
  const botMessages = (local ?? []).filter((row) => row.sender === 'bot')
  const knownLeadId = leadId || (local ?? []).find((row) => row.lead_id)?.lead_id || null
  const placeholderUpdates = remote.filter((message) => {
    const existing = localByMessageId.get(message.amoMessageId)
    return existing?.text === MANAGER_REPLY_PLACEHOLDER
      && message.text !== MANAGER_REPLY_PLACEHOLDER
  })
  if (placeholderUpdates.length) {
    const results = await Promise.all(placeholderUpdates.map((message) =>
      supabase
        .from('amocrm_messages')
        .update({
          text: message.text,
          author_name: message.authorName,
          created_at: message.createdAt,
        })
        .eq('amo_message_id', message.amoMessageId)
    ))
    const updateError = results.find((result) => result.error)?.error
    if (updateError) throw new Error(`amo history placeholder update: ${updateError.message}`)
  }
  const rows = remote.flatMap((message) => {
    if (!message.amoMessageId || existingIds.has(message.amoMessageId)) return []
    if (message.direction === 'out') {
      const timestamp = new Date(message.createdAt).getTime()
      const isBotEcho = botMessages.some((row) =>
        row.text === message.text
        && Math.abs(new Date(row.created_at).getTime() - timestamp) <= BOT_ECHO_WINDOW_MS
      )
      // Собственный ответ уже сохранён под стабильным bot:<incoming>:<part>.
      // Вторую строку с реальным id amojo не создаём, иначе UI покажет дубль.
      if (isBotEcho) return []
    }
    return [{
      amo_message_id: message.amoMessageId,
      chat_id: chatId,
      lead_id: message.leadId || knownLeadId,
      contact_id: null,
      direction: message.direction,
      sender: message.direction === 'in' ? 'client' : 'operator',
      author_name: message.authorName,
      text: message.text,
      created_at: message.createdAt,
    }]
  })
  if (!rows.length) return
  const { error: upsertError } = await supabase
    .from('amocrm_messages')
    .upsert(rows, { onConflict: 'amo_message_id', ignoreDuplicates: true })
  if (upsertError) throw new Error(`amo history import: ${upsertError.message}`)
}
