// Акцентная тема — общий источник правды для сервера (layout.tsx) и клиента
// (панель в Настройках). Хранится в обычной (не httpOnly) cookie на устройстве —
// это чисто визуальная настройка, не связана с аккаунтом пользователя.

export const ACCENT_COOKIE_NAME = 'accent'
export const DEFAULT_ACCENT = 'smilekit'

// Пресеты обязаны совпадать с блоками :root[data-accent='…'] в globals.css:
// здесь только образцы для панели в Настройках, сами токены живут в CSS.
// Устаревшая cookie со старым идентификатором акцента не пройдёт isAccentId
// и мягко вернётся к дефолту.
export const ACCENT_PRESETS = [
  { id: 'smilekit', label: 'Фиолетовый (Smilekit)', from: 'var(--brand)', to: 'var(--accent-to)' },
  { id: 'coral', label: 'Коралловый', from: '#e2554d', to: '#ff8a7a' },
  { id: 'graphite', label: 'Графитовый', from: '#4a4042', to: '#776b6e' },
  { id: 'blue', label: 'Синий', from: '#1d4ed8', to: '#3b82f6' },
  { id: 'emerald', label: 'Изумрудный', from: '#059669', to: '#10b981' },
  { id: 'amber', label: 'Янтарный', from: '#d97706', to: '#f59e0b' },
] as const

export type AccentId = (typeof ACCENT_PRESETS)[number]['id']

const ACCENT_IDS = new Set<string>(ACCENT_PRESETS.map(p => p.id))

export function isAccentId(value: string | undefined): value is AccentId {
  return !!value && ACCENT_IDS.has(value)
}
