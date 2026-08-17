'use client'

import { Clock, GripVertical, MapPin, Phone } from 'lucide-react'
import { formatMoney, getInitials } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { Deal, DealEmployee } from '@/types'
import { DEAL_SOURCE, formatStageAge } from './deal-config'

interface Props {
  deal: Deal
  employees: Map<string, DealEmployee>
  stageColor: string
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onClick: () => void
}

function Avatar({ emp }: { emp: DealEmployee }) {
  if (emp.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={emp.avatar_url}
        alt={emp.name}
        title={emp.name}
        className="h-6 w-6 rounded-full object-cover"
      style={{ boxShadow: '0 0 0 2px var(--surface)' }}
      />
    )
  }
  return (
    <div
      title={emp.name}
      className="flex h-6 w-6 items-center justify-center rounded-full brand-gradient"
      style={{ fontSize: 10, fontWeight: 600, color: 'var(--on-brand)', boxShadow: '0 0 0 2px var(--surface)' }}
    >
      {getInitials(emp.name)}
    </div>
  )
}

export default function DealCard({
  deal,
  employees,
  stageColor,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: Props) {
  const source = DEAL_SOURCE[deal.source]
  const SourceIcon = source.icon
  const responsible = deal.responsible_employee_id
    ? employees.get(deal.responsible_employee_id)
    : undefined
  const customer = deal.customer_name || deal.customer_username || deal.customer_phone

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', deal.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'group relative cursor-pointer select-none rounded-xl border p-3 shadow-sm',
        'transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md',
        dragging && 'opacity-40 rotate-[1.5deg]'
      )}
      style={{
        borderLeft: `3px solid ${stageColor}`,
        borderTop: '1px solid var(--line)',
        borderRight: '1px solid var(--line)',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="absolute right-1.5 top-2.5 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: 'var(--ink-4)' }}
        aria-hidden
      >
        <GripVertical size={14} />
      </div>

      <p className="pr-4 text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--ink)' }}>
        {deal.title}
      </p>

      {customer && customer !== deal.title && (
        <p className="mt-1 text-[12px] leading-snug line-clamp-1" style={{ color: 'var(--ink-3)' }}>{customer}</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ color: source.color, background: source.bg }}
        >
          <SourceIcon size={11} />
          {source.label}
        </span>

        {deal.amount !== null && (
          <span className="inline-flex items-center rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand)]">
            {formatMoney(deal.amount, deal.currency)}
          </span>
        )}

        {deal.customer_phone && (
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--surface-3)', color: 'var(--ink-2)' }}
          >
            <Phone size={10} />
            {deal.customer_phone}
          </span>
        )}

        {deal.city && (
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--surface-3)', color: 'var(--ink-2)' }}
          >
            <MapPin size={10} />
            {deal.city}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1 text-[10px]"
          style={{ color: 'var(--ink-3)' }}
          title="Время в текущем этапе"
        >
          <Clock size={12} />
          {formatStageAge(deal.stage_changed_at)}
        </span>
        {responsible ? (
          <Avatar emp={responsible} />
        ) : (
          <span className="text-[10px]" style={{ color: 'var(--ink-4)' }}>без ответственного</span>
        )}
      </div>
    </div>
  )
}
