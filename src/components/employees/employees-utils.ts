// ─── employees-utils.ts ───────────────────────────────────────────────────────

export const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  'Владелец':  { bg: 'var(--brand)', text: 'var(--surface)' },
  'РОП':       { bg: 'var(--brand)', text: 'var(--surface)' },
  'МП':        { bg: 'var(--ink-3)', text: 'var(--ink)' },
  'ЛМАИ':      { bg: 'var(--line)', text: 'var(--ink)' },
  'Бухгалтер': { bg: 'var(--line)', text: 'var(--ink)' },
}

export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  active:    { bg: 'var(--ok-soft)', text: '#166534', label: 'Активен' },
  probation: { bg: 'var(--warn-soft)', text: 'var(--warn)', label: 'Испытательный' },
  archived:  { bg: 'var(--surface-2)', text: 'var(--ink-3)', label: 'Архив' },
}

export function kpiColor(pct: number): string {
  if (pct >= 100) return '#166534'
  if (pct >= 80)  return 'var(--warn)'
  return 'var(--brand)'
}

export function kpiBg(pct: number): string {
  if (pct >= 100) return 'var(--ok-soft)'
  if (pct >= 80)  return 'var(--warn-soft)'
  return '#fee2e2'
}

export function fmtMoney(v: number): string {
  if (v === 0) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KGS', maximumFractionDigits: 0 }).format(v)
}

export function fmtDate(s: string | null): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

export const MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
]
