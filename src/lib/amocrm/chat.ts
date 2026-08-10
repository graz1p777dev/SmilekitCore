// Отправка сообщений в чаты amoCRM (WhatsApp-канал самого амо).
//
// Публичного v4-эндпоинта для этого нет. Рабочая механика (проверена в проде
// DemiResults, backend/app/services/amocrm.py): обычным Bearer-токеном
// создаётся чат-сессия /ajax/v1/chats/session, из неё берётся amojo-токен,
// и им шлётся сообщение в amojo.amocrm.ru — то же, что делает веб-интерфейс
// амо, когда менеджер пишет в чат руками.

const AMOJO_BASE_URL = 'https://amojo.amocrm.ru'

interface ChatSession {
  accountId: string
  accessToken: string
}

async function createChatSession(): Promise<ChatSession> {
  const domain = process.env.AMOCRM_DOMAIN
  const token = process.env.AMOCRM_ACCESS_TOKEN
  if (!domain || !token) throw new Error('AMOCRM_DOMAIN / AMOCRM_ACCESS_TOKEN не заданы')

  const res = await fetch(`https://${domain}/ajax/v1/chats/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ 'request[chats][session][action]': 'create' }),
  })
  if (!res.ok) throw new Error(`amo chat session: HTTP ${res.status}`)
  const data = await res.json()
  const session = data?.response?.chats?.session
  const accountId = session?.account?.id
  const accessToken = session?.access_token
  if (!accountId || !accessToken) throw new Error('amo chat session: нет account id/token в ответе')
  return { accountId, accessToken }
}

export interface SendChatMessageInput {
  chatId: string
  leadId: string | null
  contactId: string | null
  text: string
}

/** Отправляет текст клиенту в чат amoCRM от имени аккаунта. Бросает при сбое. */
export async function sendAmoChatMessage({ chatId, leadId, contactId, text }: SendChatMessageInput): Promise<void> {
  const session = await createChatSession()
  const payload = new URLSearchParams({
    silent: 'false',
    priority: 'low',
    'crm_entity[id]': leadId ?? '',
    'crm_entity[type]': '2',
    persona_name: 'Smilekit',
    text,
    crm_contact_id: contactId ?? '',
    skip_link_shortener: 'false',
  })
  const res = await fetch(`${AMOJO_BASE_URL}/v1/chats/${session.accountId}/${chatId}/messages`, {
    method: 'POST',
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/x-www-form-urlencoded',
      'x-auth-token': session.accessToken,
      chatId,
    },
    body: payload,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`amojo send: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
}
