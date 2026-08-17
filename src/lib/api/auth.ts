// Публичный REST API CRM: аутентификация и общие ответы.
//
// Ключ передаётся заголовком `Authorization: Bearer <ключ>` и хранится в
// переменной CRM_API_TOKEN (её можно задать на странице «Интеграции», как
// и остальные переменные). Отдельного пользователя у ключа нет: это
// машинный доступ, поэтому запросы идут через admin-клиент в обход RLS —
// и именно поэтому ключ приравнивается к правам владельца.

import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { vars } from '@/core/variables'

export const API_TOKEN_VAR = 'CRM_API_TOKEN'

/** Ошибка в едином формате: { error: "текст" } и правильный статус. */
export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

/**
 * Проверяет ключ. Возвращает null, если всё в порядке, иначе — готовый
 * ответ с ошибкой (вызывающему остаётся его вернуть).
 */
export async function requireApiToken(request: Request): Promise<NextResponse | null> {
  const expected = await vars.get(API_TOKEN_VAR)
  if (!expected) {
    // Пока ключ не задан, API закрыт целиком: «нет ключа» не должно
    // означать «пускаем всех».
    return apiError(`API выключен: задайте переменную ${API_TOKEN_VAR} в разделе «Интеграции»`, 503)
  }

  const header = request.headers.get('authorization')
  if (!header) return apiError('Нужен заголовок Authorization: Bearer <ключ>', 401)

  // Сравнение постоянного времени: обычное === по времени ответа
  // подсказывает подбирающему, какой префикс он угадал.
  const given = Buffer.from(header)
  const want = Buffer.from(`Bearer ${expected}`)
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return apiError('Неверный ключ', 401)
  }

  return null
}

/** Разбор тела запроса с понятной ошибкой вместо падения роута. */
export async function readJson(request: Request): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  try {
    const data = await request.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, response: apiError('Тело запроса должно быть JSON-объектом', 400) }
    }
    return { ok: true, data: data as Record<string, unknown> }
  } catch {
    return { ok: false, response: apiError('Некорректный JSON в теле запроса', 400) }
  }
}

/**
 * Обёртка над обработчиком: любая необработанная ошибка превращается в
 * понятный JSON, а не в стену стека. Чаще всего это отсутствующий
 * SUPABASE_SERVICE_ROLE_KEY в локальной среде — интегратору важно увидеть
 * причину, а не «500 Internal Server Error».
 */
export async function guard(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    if (message.includes('Missing Supabase admin credentials')) {
      return apiError('На сервере не задан SUPABASE_SERVICE_ROLE_KEY — API не может обратиться к базе', 503)
    }
    return apiError(message, 500)
  }
}

/** Постраничная выборка: ?limit=50&offset=0. Потолок защищает от выгрузки всего. */
export function readPaging(url: URL): { limit: number; offset: number } {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  return { limit, offset }
}
