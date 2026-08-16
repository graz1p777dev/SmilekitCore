// Общие переменные интеграций: одно объявление — и настройки, и документация,
// и проверка «что не задано».
//
// Где что лежит и почему:
//   env (process.env)      — секреты и адреса: токены, домены инстансов.
//                            Меняются деплоем, в UI не показываются.
//   settings.extra[key]    — то, что владелец правит из CRM: шаблоны текстов,
//                            свои правила, id группы доставки, вебхуки.
//                            Отдельной таблицы под интеграцию нет намеренно:
//                            settings — уже существующий singleton компании
//                            с JSONB-полем extra ровно под такие расширения.
//
// Чтение без кэша, один SELECT на сообщение — сознательный компромисс:
// зато в UI никогда не показано не то, что реально применяется ботом.
// Внутри одной обработки конфиг читается один раз и передаётся в политику
// через контекст, так что лишних запросов это не создаёт.

import { createAdminClient } from '@/lib/supabase/admin'
import type { ConfigHandle, EnvSpec } from './types'

export interface ConfigSpec<T> {
  /** Ключ в settings.extra и id в документации. */
  key: string
  /** Переменные окружения этой интеграции — с описанием для /docs. */
  env?: Record<string, EnvSpec>
  /** Значения по умолчанию: то, что применяется, пока владелец не менял. */
  defaults: T
}

const declared: ConfigHandle<unknown>[] = []

export function defineConfig<T extends object>(spec: ConfigSpec<T>): ConfigHandle<T> {
  const env = spec.env ?? {}

  const handle: ConfigHandle<T> = {
    key: spec.key,
    env,

    async get(): Promise<T> {
      const admin = createAdminClient()
      const { data } = await admin.from('settings').select('id, extra').limit(1).maybeSingle()
      const extra = (data as { extra?: Record<string, unknown> } | null)?.extra ?? {}
      const stored = (extra[spec.key] ?? {}) as Partial<T>
      // Поверхностное слияние: вложенные объекты интеграция описывает как
      // целые значения (templates, stock) — частичный merge вглубь давал бы
      // «полуприменённые» настройки, которые нельзя объяснить в UI.
      return { ...spec.defaults, ...stored }
    },

    async save(patch: Partial<T>) {
      const admin = createAdminClient()
      const { data: row } = await admin.from('settings').select('id, extra').limit(1).maybeSingle()
      if (!row) return { ok: false as const, error: 'Таблица settings пуста — компания не инициализирована' }
      const extra = ((row as { extra?: Record<string, unknown> }).extra ?? {}) as Record<string, unknown>
      const current = (extra[spec.key] ?? spec.defaults) as T
      const { error } = await admin
        .from('settings')
        .update({ extra: { ...extra, [spec.key]: { ...current, ...patch } } })
        .eq('id', (row as { id: string }).id)
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    },

    envValue(name: string) {
      return process.env[name]?.trim() || undefined
    },

    missingEnv() {
      return Object.entries(env)
        .filter(([name, spec]) => spec.required && !process.env[name]?.trim())
        .map(([name]) => name)
    },
  }

  declared.push(handle as ConfigHandle<unknown>)
  return handle
}

/** Все объявленные конфиги — для страницы состояния интеграций и документации. */
export function listConfigs(): ConfigHandle<unknown>[] {
  return [...declared]
}

/**
 * Переменная, без которой код физически не может работать (адрес API, токен).
 * Бросает с понятным текстом вместо того, чтобы уйти в fetch(undefined).
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Переменная ${name} не задана`)
  return value
}

/** Список chatId из переменной вида "996500111222,996700333444". */
export function envList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}
