// Переменные интеграций: то, что раньше правилось только деплоем.
//
// Приоритет: значение из базы (введено на сайте) → переменная окружения.
// Такой порядок позволяет переносить настройку в браузер постепенно: пока
// в базе пусто, всё работает ровно как раньше, на переменных Railway.
//
// Секреты хранятся зашифрованными (core/crypto.ts) и наружу отдаются только
// хвостом «••••4f2a». Расшифровка происходит исключительно на сервере, в
// момент обращения интеграции.
//
// Кэш: одна выборка всей таблицы на 30 секунд. Таблица крошечная, а
// обращений много (каждое сообщение), поэтому запрос на переменную был бы
// расточительным. Сохранение с сайта сбрасывает кэш сразу — владелец видит
// эффект правки без ожидания.

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret, encryptSecret, isEncryptionConfigured, secretHint } from './crypto'
import { log } from './logger'

const TABLE = 'integration_variables'
const CACHE_TTL_MS = 30_000

export interface VariableRow {
  name: string
  integrationId: string | null
  description: string | null
  isSecret: boolean
  /** Открытое значение или маска секрета — безопасно показывать в UI. */
  display: string
  /** Значение задано в переменных окружения, а не в базе. */
  fromEnv: boolean
  updatedAt: string | null
}

interface CacheEntry {
  values: Map<string, string>
  loadedAt: number
}

let cache: CacheEntry | null = null

export function invalidate(): void {
  cache = null
}

async function load(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.values

  const values = new Map<string, string>()
  // Таблицы ещё нет, база недоступна или не задан service-ключ — это не
  // повод уронить бота: возвращаем пустую карту, и всё работает на
  // переменных окружения, как до появления этой страницы.
  let data: unknown[] | null = null
  try {
    const result = await createAdminClient()
      .from(TABLE)
      .select('name, is_secret, value, value_encrypted')
    if (result.error) {
      log.warn(`переменные из базы недоступны: ${result.error.message}`)
      return values
    }
    data = result.data
  } catch (error) {
    log.warn('переменные из базы недоступны', error)
    return values
  }

  for (const row of data ?? []) {
    const item = row as { name: string; is_secret: boolean; value: string | null; value_encrypted: string | null }
    try {
      const value = item.is_secret
        ? item.value_encrypted
          ? decryptSecret(item.value_encrypted)
          : null
        : item.value
      if (value) values.set(item.name, value)
    } catch (error) {
      // Чаще всего это смена INTEGRATION_ENCRYPTION_KEY. Пропускаем именно
      // это значение: остальные переменные должны продолжать работать.
      log.error(`переменную ${item.name} не удалось расшифровать`, error)
    }
  }

  cache = { values, loadedAt: Date.now() }
  return values
}

/** Значение переменной: сначала база, затем переменная окружения. */
export async function get(name: string): Promise<string | undefined> {
  const values = await load()
  return values.get(name) ?? (process.env[name]?.trim() || undefined)
}

/**
 * Синхронное чтение из уже загруженного кэша — только для мест, где нельзя
 * ждать (проверки «настроено ли» в интерфейсе). До первой загрузки видит
 * лишь переменные окружения, поэтому на старте вызывается warmup().
 */
export function snapshot(name: string): string | undefined {
  return cache?.values.get(name) ?? (process.env[name]?.trim() || undefined)
}

/** Прогрев кэша при старте сервера. */
export async function warmup(): Promise<void> {
  await load()
}

/** Значение, без которого интеграция не работает. */
export async function requireValue(name: string): Promise<string> {
  const value = await get(name)
  if (!value) throw new Error(`Переменная ${name} не задана — заполните её в разделе «Интеграции»`)
  return value
}

/** Список через запятую: номера для обкатки, домены и т.п. */
export async function list(name: string): Promise<string[]> {
  const value = await get(name)
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Все переменные для страницы настроек — уже безопасные для показа. */
export async function listAll(): Promise<VariableRow[]> {
  let data: unknown[] | null = null
  try {
    const result = await createAdminClient()
      .from(TABLE)
      .select('name, integration_id, description, is_secret, value, value_hint, updated_at')
      .order('name')
    if (result.error) return []
    data = result.data
  } catch {
    return []
  }

  return (data ?? []).map((row) => {
    const item = row as {
      name: string
      integration_id: string | null
      description: string | null
      is_secret: boolean
      value: string | null
      value_hint: string | null
      updated_at: string
    }
    return {
      name: item.name,
      integrationId: item.integration_id,
      description: item.description,
      isSecret: item.is_secret,
      display: item.is_secret ? (item.value_hint ?? '••••') : (item.value ?? ''),
      fromEnv: false,
      updatedAt: item.updated_at,
    }
  })
}

export interface SaveVariableInput {
  name: string
  value: string
  isSecret: boolean
  integrationId?: string | null
  description?: string | null
}

export async function save(input: SaveVariableInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim()
  // Имя ложится в те же ячейки, что и переменные окружения, и подставляется
  // по точному совпадению — вольный формат здесь только запутает.
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) {
    return { ok: false, error: 'Имя: латиница в верхнем регистре, цифры и _, до 64 символов' }
  }
  if (input.isSecret && !isEncryptionConfigured()) {
    return { ok: false, error: 'INTEGRATION_ENCRYPTION_KEY не задана — секреты сохранять некуда' }
  }
  // Переменная — это ключ, адрес или список номеров. Всё, что длиннее,
  // почти наверняка вставлено по ошибке (файл, дамп) и только раздувает
  // таблицу, которая читается на каждое сообщение.
  if (input.value.length > 4096) return { ok: false, error: 'Значение длиннее 4096 символов' }

  const row = {
    name,
    integration_id: input.integrationId ?? null,
    description: input.description ?? null,
    is_secret: input.isSecret,
    value: input.isSecret ? null : input.value,
    value_encrypted: input.isSecret ? encryptSecret(input.value) : null,
    value_hint: input.isSecret ? secretHint(input.value) : null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await createAdminClient().from(TABLE).upsert(row, { onConflict: 'name' })
  if (error) return { ok: false, error: error.message }
  invalidate()
  return { ok: true }
}

export async function remove(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createAdminClient().from(TABLE).delete().eq('name', name)
  if (error) return { ok: false, error: error.message }
  invalidate()
  return { ok: true }
}

export const vars = { get, requireValue, snapshot, warmup, list, listAll, save, remove, invalidate }
