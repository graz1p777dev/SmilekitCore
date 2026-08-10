import type { OrderCurrency, OrderStatus } from '@/types'

// ─── Статусы заказа ──────────────────────────────────────────────────────────
// Это линия исполнения, а не воронка продаж: воронка живёт в deal_stages и
// настраивается владельцем, а здесь набор фиксированный и намеренно короткий.
// Цвета — только из токенов: фиолетовый бренд, янтарь на отгрузке, зелёный
// на доставке. Мелкий светлый текст на янтаре и светлом фиолетовом запрещён,
// поэтому текст везде тёмный, а бренд/янтарь работают заливкой.

export interface OrderStatusMeta {
  label: string
  color: string
  bg: string
}

export const ORDER_STATUS: Record<OrderStatus, OrderStatusMeta> = {
  new:       { label: 'Новый',        color: 'var(--brand-ink)',   bg: 'var(--brand-soft)' },
  confirmed: { label: 'Подтверждён',  color: 'var(--brand-strong)', bg: 'var(--surface-3)' },
  shipped:   { label: 'Отправлен',    color: 'var(--warn)',        bg: 'var(--warn-soft)' },
  delivered: { label: 'Доставлен',    color: 'var(--ok)',          bg: 'var(--ok-soft)' },
  cancelled: { label: 'Отменён',      color: 'var(--ink-3)',       bg: 'var(--surface-2)' },
}

/** Порядок в фильтрах и переключателе статуса. */
export const ORDER_STATUS_ORDER: OrderStatus[] = [
  'new', 'confirmed', 'shipped', 'delivered', 'cancelled',
]

export type OrderPeriod = 'all' | 'today' | 'week' | 'month'

export const ORDER_PERIODS: { value: OrderPeriod; label: string }[] = [
  { value: 'all',   label: 'Всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week',  label: '7 дней' },
  { value: 'month', label: '30 дней' },
]

/** Начало периода в миллисекундах; null — фильтр выключен. */
export function periodStart(period: OrderPeriod): number | null {
  if (period === 'all') return null
  if (period === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  const days = period === 'week' ? 7 : 30
  return Date.now() - days * 24 * 60 * 60 * 1000
}

/** Сумма заказа. Неизвестное количество даёт null — прочерк, а не ноль. */
export function formatOrderMoney(amount: number | null, currency: OrderCurrency): string {
  if (amount === null) return '—'
  return `${amount.toLocaleString('ru-RU')} ${currency}`
}

export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
