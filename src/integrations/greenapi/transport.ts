// Транспорт Green API: единственное место канала, которое реально ходит в сеть.
//
// Ядро даёт сюда уже готовое сообщение и ждёт либо успеха, либо исключения —
// на исключении оно само снимет бронь в переписке. Поэтому здесь нет ни
// логов «не отправилось», ни записи в историю: только отправка.

import {
  sendGreenApiFileByUrl,
  sendGreenApiMessage,
  sendGreenApiVoice,
  toGreenApiChatId,
} from '@/lib/greenapi/client'
import type { ChannelTransport, OutboundMessage } from '@/core'

export const greenapiTransport: ChannelTransport = {
  async send(chatId: string, message: OutboundMessage): Promise<void> {
    const address = toGreenApiChatId(chatId)

    if (message.media?.voice) {
      try {
        await sendGreenApiVoice(address, message.media.url, message.media.fileName)
        return
      } catch (error) {
        // Голосовой «пузырь» рендерится только для настоящего OGG/Opus.
        // Если не вышло — клиент всё равно должен получить ту же реплику
        // текстом, молчание здесь хуже отсутствия голосового.
        if (!message.text) throw error
        await sendGreenApiMessage(address, message.text)
        return
      }
    }

    if (message.media) {
      await sendGreenApiFileByUrl({
        chatId: address,
        urlFile: message.media.url,
        fileName: message.media.fileName,
        caption: message.media.caption,
      })
      return
    }

    if (!message.text) throw new Error('пустое сообщение: нет ни текста, ни медиа')
    await sendGreenApiMessage(address, message.text)
  },
}

/** Базовый адрес медиафайлов бота (голосовые, фото результатов, QR). */
export function mediaBaseUrl(): string | null {
  return process.env.SMILEKIT_BOT_API_URL?.replace(/\/$/, '') || null
}
