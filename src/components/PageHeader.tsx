import { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}

/**
 * Шапка страницы. Красная планка слева от заголовка — фирменный элемент
 * системы («пролёт»): она одна и та же на всех экранах, поэтому страницы
 * читаются как один продукт.
 */
export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-4 md:px-8 md:py-5"
      style={{
        // Полупрозрачное стекло: сквозь шапку просвечивает аврора фона,
        // страница выглядит одним слоем, а не стопкой белых плашек.
        background: 'color-mix(in srgb, var(--surface) 72%, transparent)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div className="span-rule min-w-0">
        <h1 className="truncate" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="truncate" style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
