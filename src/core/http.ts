// Общий HTTP-клиент для интеграций.
//
// Зачем вообще: каждый провайдер писал свой fetch с таймаутом и своей
// трактовкой ошибки (green-api бросал, smilekit-bot возвращал значение,
// amojo молча глотал). Разные трактовки в одном пайплайне — это разные
// пути отката, поэтому здесь ровно два режима и оба явные:
//   request()      — ошибка как значение (для UI: показать причину)
//   requestOrThrow — ошибка броском (для транспорта: ядро откатит запись)

const DEFAULT_TIMEOUT_MS = 20_000

export type HttpResult<T> = { ok: true; data: T; status: number } | { ok: false; error: string; status: number }

export interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  /** Сколько раз повторить при сетевой ошибке/5xx. По умолчанию без повторов. */
  retries?: number
  /** Ответ не JSON (медиа, текст) — вернуть как строку. */
  raw?: boolean
}

export async function request<T>(url: string, options: RequestOptions = {}): Promise<HttpResult<T>> {
  const attempts = Math.max(1, (options.retries ?? 0) + 1)
  let last: HttpResult<T> = { ok: false, error: 'запрос не выполнялся', status: 0 }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await once<T>(url, options)
    if (last.ok || last.status === 0) {
      if (last.ok) return last
    }
    // Повторяем только то, что имеет шанс пройти со второй попытки:
    // сеть/таймаут (status 0) и 5xx. 4xx повторять бессмысленно.
    const retryable = last.status === 0 || last.status >= 500
    if (!retryable || attempt === attempts) return last
    await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
  }

  return last
}

async function once<T>(url: string, options: RequestOptions): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { ...options.headers }
  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json'
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    // status 0 — «до сервера не дошли»: сеть, DNS, таймаут.
    return { ok: false, status: 0, error: error instanceof Error ? error.message : 'сеть недоступна' }
  }

  const text = await response.text().catch(() => '')
  if (!response.ok) {
    return { ok: false, status: response.status, error: `HTTP ${response.status} ${text.slice(0, 300)}` }
  }
  if (options.raw) return { ok: true, status: response.status, data: text as T }
  try {
    return { ok: true, status: response.status, data: (text ? JSON.parse(text) : {}) as T }
  } catch {
    return { ok: false, status: response.status, error: 'ответ не JSON' }
  }
}

export async function requestOrThrow<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const result = await request<T>(url, options)
  if (!result.ok) throw new Error(`${options.method ?? 'GET'} ${url}: ${result.error}`)
  return result.data
}

export interface BinaryFile {
  bytes: Buffer
  mime: string
}

/**
 * Скачать вложение с ограничением размера — медиа из вебхуков бывает любым.
 * Размер проверяется дважды: по заголовку (дёшево) и по факту (заголовок
 * могут не прислать или соврать).
 */
export async function fetchBinary(url: string, maxBytes: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BinaryFile> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`скачивание ${url}: HTTP ${response.status}`)
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('файл больше лимита')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > maxBytes) throw new Error('файл пустой или больше лимита')
  return { bytes, mime: response.headers.get('content-type') ?? 'application/octet-stream' }
}
