import type {
  ConsultationStatus,
  ActualStatus,
  StatusAfterFv,
  AlbStatus,
  AttendanceStatus,
  UserRole,
  EmployeeStatus,
  SalaryStatus,
} from '@/types'

// ============================================================
// Consultation status labels & colors
// ============================================================

export const CONSULTATION_STATUS_MAP: Record<
  ConsultationStatus,
  { label: string; color: string; bg: string }
> = {
  'Придёт':      { label: 'Придёт',      color: '#166534', bg: 'var(--ok-soft)' },
  'Не придёт':   { label: 'Не придёт',   color: 'var(--brand)', bg: '#fee2e2' },
  'Перезапись':  { label: 'Перезапись',  color: '#92400e', bg: '#fef3c7' },
  'Отменил':     { label: 'Отменил',     color: 'var(--ink-3)', bg: 'var(--surface-2)' },
  'Не отвечает': { label: 'Не отвечает', color: 'var(--brand)', bg: 'var(--surface-2)' },
}

export const ACTUAL_STATUS_MAP: Record<
  ActualStatus,
  { label: string; color: string; bg: string }
> = {
  'Пришла':    { label: 'Пришла',    color: '#166534', bg: 'var(--ok-soft)' },
  'Не пришла': { label: 'Не пришла', color: 'var(--brand)', bg: '#fee2e2' },
}

export const STATUS_AFTER_FV_MAP: Record<
  StatusAfterFv,
  { label: string; color: string; bg: string }
> = {
  'Купила':    { label: 'Купила',    color: '#166534', bg: 'var(--ok-soft)' },
  'Не купила': { label: 'Не купила', color: 'var(--brand)', bg: '#fee2e2' },
  'Предоплата':{ label: 'Предоплата',color: 'var(--brand)', bg: 'var(--brand-soft)' },
  'Дожать':    { label: 'Дожать',    color: '#92400e', bg: '#fef3c7' },
  'Отказ':     { label: 'Отказ',     color: 'var(--ink-3)', bg: 'var(--surface-2)' },
}

export const NOTIFICATION_TYPE_MAP: Record<
  string,
  { label: string; icon: string; color: string; bg: string }
> = {
  server_load:            { label: 'Нагрузка сервера',     icon: '⚠️', color: 'var(--brand)', bg: '#fee2e2' },
  sale_lead:               { label: 'Хочет купить',         icon: '🛒', color: '#166534', bg: '#bbf7d0' },
  order_new:                { label: 'Новый заказ',          icon: '📦', color: 'var(--brand)', bg: 'var(--brand-soft)' },
  consultation_booked:     { label: 'Запись на консультацию', icon: '📅', color: 'var(--brand)', bg: 'var(--brand-soft)' },
  consultation_reminder:   { label: 'Скоро консультация',   icon: '⏰', color: '#92400e', bg: '#fef3c7' },
  deploy:                   { label: 'Деплой',               icon: '🚀', color: 'var(--brand)', bg: 'var(--brand-soft)' },
  security:                 { label: 'Безопасность',         icon: '🔒', color: 'var(--brand)', bg: '#fee2e2' },
  audit:                    { label: 'Изменение записи',     icon: '✏️', color: 'var(--ink-3)', bg: 'var(--surface-2)' },
  bot_reply:                { label: 'Ответ бота',           icon: '🤖', color: 'var(--brand)', bg: 'var(--brand-soft)' },
  kpi_alert:                { label: 'KPI',                  icon: '📉', color: 'var(--brand)', bg: '#fee2e2' },
  kpi_success:              { label: 'KPI',                  icon: '📈', color: '#166534', bg: 'var(--ok-soft)' },
  plan_100:                 { label: 'План выполнен',        icon: '🎯', color: '#166534', bg: 'var(--ok-soft)' },
  absence:                  { label: 'Отсутствие',           icon: '🚫', color: '#92400e', bg: '#fef3c7' },
  salary_ready:             { label: 'Зарплата',             icon: '💰', color: '#166534', bg: 'var(--ok-soft)' },
  finance_alert:            { label: 'Финансы',              icon: '💸', color: 'var(--brand)', bg: '#fee2e2' },
  sale:                      { label: 'Продажа',              icon: '✅', color: '#166534', bg: 'var(--ok-soft)' },
  system:                   { label: 'Система',              icon: 'ℹ️', color: 'var(--ink-3)', bg: 'var(--surface-2)' },
}

export const ALB_STATUS_MAP: Record<
  AlbStatus,
  { label: string; color: string; bg: string }
> = {
  'Не записан': { label: 'Не записан', color: 'var(--ink-3)', bg: 'var(--surface-2)' },
  'Записан':    { label: 'Записан',    color: 'var(--brand)', bg: 'var(--brand-soft)' },
  'Пришёл':     { label: 'Пришёл',    color: '#166534', bg: 'var(--ok-soft)' },
  'Не пришёл':  { label: 'Не пришёл', color: 'var(--brand)', bg: '#fee2e2' },
  'Купил':      { label: 'Купил',     color: '#166534', bg: '#bbf7d0' },
}

export const FORMAT_BADGE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  'Онлайн': { label: 'Онлайн', color: 'var(--brand)', bg: 'var(--brand-soft)' },
  'Офлайн': { label: 'Офлайн', color: '#c2410c', bg: '#ffedd5' },
}

// ============================================================
// Attendance status labels & colors
// ============================================================

export const ATTENDANCE_STATUS_MAP: Record<
  AttendanceStatus,
  { label: string; color: string; dot: string }
> = {
  // Точка несёт цвет и может быть яркой (это графика, порог 3:1),
  // а подпись рядом берёт затемнённый вариант того же тона — ей нужен AA.
  present:  { label: 'На месте',  color: 'var(--ok)', dot: 'bg-[#16a34a]' },
  remote:   { label: 'Удалённо',  color: 'var(--brand)', dot: 'bg-[var(--brand)]' },
  absent:   { label: 'Отсутствует',color: 'var(--brand)',dot: 'bg-[var(--brand)]' },
  sick:     { label: 'Больничный',color: 'var(--warn)', dot: 'bg-[#f59e0b]' },
  vacation: { label: 'Отпуск',    color: 'var(--brand)', dot: 'bg-[#e2554d]' },
  day_off:  { label: 'Выходной',  color: 'var(--ink-3)', dot: 'bg-[var(--ink-4)]' },
  weekend:  { label: 'Выходной',  color: 'var(--ink-3)', dot: 'bg-[var(--ink-4)]' },
}

// ============================================================
// Employee role labels
// ============================================================

export const ROLE_LABELS: Record<UserRole, string> = {
  owner:     'Владелец',
  rop:       'РОП',
  mp:        'МП',
  lmai:      'LMAI',
  accountant:'Бухгалтер',
}

export const EMPLOYEE_STATUS_MAP: Record<
  EmployeeStatus,
  { label: string; color: string }
> = {
  active:   { label: 'Активен',    color: 'var(--ok)' },
  vacation: { label: 'В отпуске',  color: 'var(--warn)' },
  sick:     { label: 'На больничном', color: 'var(--brand)' },
  archived: { label: 'Архив',      color: 'var(--ink-3)' },
}

// ============================================================
// Salary status labels & colors
// ============================================================

export const SALARY_STATUS_MAP: Record<
  SalaryStatus,
  { label: string; color: string; bg: string }
> = {
  draft:    { label: 'Черновик',  color: 'var(--ink-3)', bg: 'var(--surface-2)' },
  approved: { label: 'Утверждён', color: '#92400e', bg: '#fef3c7' },
  paid:     { label: 'Выплачен',  color: '#166534', bg: 'var(--ok-soft)' },
}

// ============================================================
// KPI progress thresholds (color breakpoints)
// ============================================================

export const KPI_THRESHOLDS = {
  danger:  30,  // < 30% → crimson
  warning: 60,  // 30–60% → amber
  brand:   90,  // 60–90% → brand red
  success: 100, // ≥ 90% → green
} as const

export function getKpiColor(pct: number): string {
  if (pct < KPI_THRESHOLDS.danger)  return 'var(--brand)' // deep crimson (danger)
  if (pct < KPI_THRESHOLDS.warning) return 'var(--warn)' // amber
  if (pct < KPI_THRESHOLDS.success) return 'var(--brand)' // brand red
  return 'var(--ok)'                                    // green
}

// ============================================================
// Finance transaction types
// ============================================================

export const TRANSACTION_TYPE_LABELS = {
  income:  { label: 'Доход',  color: 'var(--ok)' },
  expense: { label: 'Расход', color: 'var(--brand)' },
} as const

// ============================================================
// Brand palette (from Design System)
// ============================================================

export const BRAND = {
  ink:      'var(--ink)',
  accent:   'var(--brand)',
  steel:    'var(--ink-3)',
  fog:      'var(--line)',
  sidebar:  'var(--ink)',
} as const
