// Вебхук Green API.
//
// Маршрут делает ровно три вещи: проверяет подпись, разбирает тело и отдаёт
// сообщение ядру. Вся обработка (очередь, дедупликация, история, бот) идёт
// фоном — вебхуку важно ответить 200 быстро, иначе провайдер начнёт слать
// повторы.
//
// Импорт '@/integrations' обязателен: он же и есть регистрация каналов.

import { NextRequest, NextResponse } from 'next/server'
import { receive, receiveOperatorMessage } from '@/core'
import '@/integrations'
import { isAuthorized, parseWebhook, type GreenApiWebhookBody } from '@/integrations/greenapi'

export async function POST(request: NextRequest) {
  // Green API шлёт Authorization: Bearer <webhookUrlToken> (см. setGreenApiWebhook).
  if (!(await isAuthorized(request.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as GreenApiWebhookBody | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const parsed = parseWebhook(body)
  if (parsed.type === 'inbound') {
    void receive('greenapi', parsed.message)
  } else if (parsed.type === 'operator') {
    void receiveOperatorMessage('greenapi', parsed.message)
  }

  return NextResponse.json({ ok: true })
}
