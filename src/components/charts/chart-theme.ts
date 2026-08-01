import type { CSSProperties } from 'react'

// Категориальная палитра графиков. Recharts не резолвит CSS-переменные в
// stop-color градиентов на всех рендерерах, поэтому держим литералы,
// синхронизированные с --chart-1..5 в globals.css.
//
// Правило подбора: серии обязаны отличаться и по тону, и по светлоте —
// «все оттенки фиолетового» нечитаемы. Ядро — фирменный фиолетовый и янтарь
// витрины, к ним добавлены холодный зелёный и рыжий как контрапункты.
//
// Ключи названы по роли, а не по цвету: сменить палитру можно, не переписывая
// графики.
//                              тон  светлота
export const CHART_COLORS = {
  primary: '#5115a4', //   276°   36%  — главная серия: выручка, факт, баланс
  secondary: '#f5a623', //    38°   55%  — вторая серия: обращения, ROMI, показы
  positive: '#2f7d64', //   163°   34%  — план, прибыль (холодный контрапункт)
  negative: '#b5491f', //    17°   42%  — расходы, убыток
  neutral: '#78708a', //   260°   49%  — прочее, вспомогательные линии
  soft: '#b48ce0', //   271°   72%  — светлый акцент, дальние доли
} as const

export const CHART_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.positive,
  CHART_COLORS.negative,
  CHART_COLORS.neutral,
  CHART_COLORS.soft,
]

// Цвета серий подобраны для заливок и линий — как текст часть из них не
// читается (янтарь даёт 2.03:1 на белом, лиловый — 2.70:1). Поэтому для
// подписей, чисел в таблицах и легенд берём затемнённые двойники того же
// тона: все ≥ 6.2:1 на белом.
export const CHART_TEXT = {
  primary: '#5115a4', // 10.54:1
  secondary: '#92400e', //  7.09:1
  positive: '#2b6b56', //  6.29:1
  negative: '#9a3c18', //  6.92:1
  neutral: '#5f5870', //  6.74:1
  soft: '#6a2fb8', //  7.74:1
} as const

export const CHART_TICK = { fontSize: 11, fill: '#8b8299' }
export const CHART_MARGIN = { top: 4, right: 4, left: -16, bottom: 0 }

// Подсказка светлая: под ней белая бумага, тёмный тултип бил бы по глазам.
export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.97)',
  backdropFilter: 'blur(10px)',
  border: '1px solid #e9e4f2',
  borderRadius: 10,
  fontSize: 12,
  color: '#17102a',
  boxShadow: '0 12px 32px -12px rgba(54,14,127,0.2)',
}

export const CHART_GRID_STROKE = 'rgba(23,16,42,0.07)'
