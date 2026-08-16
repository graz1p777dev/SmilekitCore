'use server'

// Песочница для теста WhatsApp-канала (Green API): в отличие от
// /dashboard/laboratory (тестирует только AI-ядро менеджер+супервизор без
// сценариев), здесь гоняется РЕАЛЬНЫЙ пайплайн ядра — тот же самый
// код, что обрабатывает настоящие сообщения клиентов: скрипт продаж, блок
// результата с фото, доставка по городу, QR оплаты, свои правила из
// настроек, follow-up-скидка. Отличия от прода — только opts:
// skipKillSwitch (не завязано на общий аварийный выключатель бота —
// можно тестировать, даже когда бот выключен для реальных клиентов) и
// dryRun (ничего не уходит в реальный Green API и не создаёт сделки в
// воронке — тестовый chat_id никогда не пересекается с настоящими номерами).

import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { receive } from '@/core'
import '@/integrations'

export interface WhatsappLabMessage {
  sender: 'client' | 'bot'
  text: string
  createdAt: string
}

function newLabChatId(): string {
  // Префикс гарантирует, что тестовый чат никогда не совпадёт с реальным
  // номером телефона (chat_id в проде — только цифры).
  return `lab-${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

async function loadHistory(chatId: string): Promise<WhatsappLabMessage[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('amocrm_messages')
    .select('sender, text, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(200)
  return (data ?? [])
    .map((row) => row as { sender: string; text: string; created_at: string })
    .filter((row) => row.sender === 'client' || row.sender === 'bot')
    .map((row) => ({
      sender: row.sender as 'client' | 'bot',
      text: row.text,
      createdAt: row.created_at,
    }))
}

export type SendWhatsappLabMessageResult =
  | { success: true; chatId: string; history: WhatsappLabMessage[] }
  | { success: false; error: string }

/** chatId — undefined на первом сообщении новой сессии, дальше приходит от клиента. */
export async function sendWhatsappLabMessage(
  chatId: string | undefined,
  text: string
): Promise<SendWhatsappLabMessageResult> {
  const trimmed = text.trim()
  if (!trimmed) return { success: false, error: 'Введите сообщение' }

  // chatId приходит из браузера, поэтому проверяем формат: без этого можно
  // подставить настоящий номер клиента и записать «ответы бота» в его живую
  // переписку (отправки не будет — dryRun, но история окажется испорчена,
  // а менеджер увидит сообщения, которых клиенту никто не слал).
  if (chatId && !/^lab-[a-f0-9]{12}$/.test(chatId)) {
    return { success: false, error: 'Некорректный идентификатор тестового чата' }
  }

  const effectiveChatId = chatId || newLabChatId()
  try {
    await receive(
      'greenapi',
      {
        providerMessageId: `lab:${randomUUID()}`,
        chatId: effectiveChatId,
        authorName: 'Тест (Лаборатория)',
        text: trimmed,
        kind: 'text',
        mediaUrl: null,
      },
      { skipKillSwitch: true, dryRun: true }
    )
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ошибка бота' }
  }

  const history = await loadHistory(effectiveChatId)
  return { success: true, chatId: effectiveChatId, history }
}
