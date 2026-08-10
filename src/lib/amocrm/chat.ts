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
  expiresAt: number
}

// Сессия живёт дни — не создаём новую на каждое сообщение: параллельные
// create-запросы изредка ловят HTTP 400, и ответ клиенту терялся.
let cachedSession: ChatSession | null = null
let sessionPromise: Promise<ChatSession> | null = null

async function getChatSession(forceNew = false): Promise<ChatSession> {
  if (!forceNew && cachedSession && cachedSession.expiresAt > Date.now() / 1000 + 60) {
    return cachedSession
  }
  if (!sessionPromise) {
    sessionPromise = (async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
        try {
          cachedSession = await createChatSession()
          return cachedSession
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    })().finally(() => {
      sessionPromise = null
    })
  }
  return sessionPromise
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
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`amo chat session: HTTP ${res.status}`)
  const data = await res.json()
  const session = data?.response?.chats?.session
  const accountId = session?.account?.id
  const accessToken = session?.access_token
  if (!accountId || !accessToken) throw new Error('amo chat session: нет account id/token в ответе')
  return { accountId, accessToken, expiresAt: Number(session?.expired_at) || Date.now() / 1000 + 3600 }
}

export interface SendChatMessageInput {
  chatId: string
  leadId: string | null
  contactId: string | null
  text: string
}

export interface AmoChatHistoryMessage {
  amoMessageId: string
  leadId: string | null
  direction: 'in' | 'out'
  authorName: string | null
  text: string
  messageType: string
  mediaUrl: string | null
  createdAt: string
}

/** Живая история чата amoCRM, включая сообщения до подключения вебхука. */
export async function getAmoChatHistory(chatId: string, limit = 200): Promise<AmoChatHistoryMessage[]> {
  if (!chatId) return []
  try {
    return await getHistoryWithSession(await getChatSession(), chatId, limit)
  } catch (error) {
    // Новая сессия помогает только при протухшем amojo-токене. При таймауте
    // повтор лишь удваивает ожидание и оставляет карточку сделки «вечной».
    if (!(error instanceof Error) || !/HTTP (401|403)\b/.test(error.message)) throw error
    return getHistoryWithSession(await getChatSession(true), chatId, limit)
  }
}

async function getHistoryWithSession(
  session: ChatSession,
  chatId: string,
  limit: number
): Promise<AmoChatHistoryMessage[]> {
  const url = new URL(`${AMOJO_BASE_URL}/v1/chats/${session.accountId}/${chatId}/messages`)
  url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 200))))
  const res = await fetch(url, {
    headers: { 'x-auth-token': session.accessToken, chatId },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`amojo history: HTTP ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data.flatMap((item: Record<string, unknown>) => {
    const message = (item.message ?? {}) as Record<string, unknown>
    const type = String(message.type || 'text')
    const media = typeof message.media === 'string' ? message.media : ''
    const text = String(message.text || item.text || '').trim() || (media ? `[${type}] ${media}` : '')
    const createdAt = Number(item.created_at)
    if (!item.id || !text || !createdAt) return []
    const author = (item.author ?? {}) as Record<string, unknown>
    const dialog = (item.dialog ?? {}) as Record<string, unknown>
    return [{
      amoMessageId: String(item.id),
      leadId: dialog.entity_id ? String(dialog.entity_id) : null,
      direction: item.recipient ? 'out' as const : 'in' as const,
      authorName: author.name ? String(author.name) : null,
      text,
      messageType: type,
      mediaUrl: media || null,
      createdAt: new Date(createdAt * 1000).toISOString(),
    }]
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Отправляет текст клиенту в чат amoCRM. Кэшированная сессия; при её
 * протухании — одна пересборка сессии и повтор. Бросает при сбое. */
export async function sendAmoChatMessage(input: SendChatMessageInput): Promise<void> {
  try {
    await sendWithSession(await getChatSession(), input)
  } catch {
    await sendWithSession(await getChatSession(true), input)
  }
}

export async function sendAmoChatVoice(
  input: Omit<SendChatMessageInput, 'text'> & { mediaUrl: string; transcript: string }
): Promise<void> {
  try {
    await sendWithSession(await getChatSession(), { ...input, text: input.transcript }, 'voice')
  } catch {
    await sendWithSession(await getChatSession(true), { ...input, text: input.transcript }, 'voice')
  }
}

async function sendWithSession(
  session: ChatSession,
  input: SendChatMessageInput & { mediaUrl?: string },
  messageType: 'text' | 'voice' = 'text'
): Promise<void> {
  const { chatId, leadId, contactId, text } = input
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
  if (messageType === 'voice' && input.mediaUrl) {
    payload.set('type', 'voice')
    payload.set('media', input.mediaUrl)
  }
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
