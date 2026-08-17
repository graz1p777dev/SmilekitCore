'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/constants'
import { getInitials } from '@/lib/formatters'
import { NAV_GROUPS } from '@/config/nav'
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { UserRole } from '@/types'

function isActiveLink(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(href + '/')
}

interface SidebarProps {
  mobileOpen?: boolean
  onClose?: () => void
}

const COLLAPSED_KEY = 'sidebar-collapsed'
const WIDTH_OPEN = 248
const WIDTH_COLLAPSED = 68

export default function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const role = user?.role as UserRole | undefined

  // Панель раскрыта постоянно и сворачивается ТОЛЬКО по кнопке.
  // Прежняя версия раскрывалась по наведению и толкала страницу — курсор
  // приезжал к пункту, а контент под ним уезжал. Инструмент, в котором
  // сидят весь день, не должен шевелиться сам по себе.
  const [collapsed, setCollapsed] = useState(false)
  // Анимацию ширины включаем только после того, как прочитали сохранённое
  // состояние: иначе при загрузке панель заметно «схлопывается» на глазах.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Читаем после монтирования, а не в useState: на сервере localStorage
    // нет, и разошедшаяся разметка дала бы ошибку гидратации.
    const saved = localStorage.getItem(COLLAPSED_KEY) === '1'
    requestAnimationFrame(() => {
      setCollapsed(saved)
      setReady(true)
    })
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  // На мобильном drawer всегда показывает подписи целиком.
  const showLabels = mobileOpen || !collapsed

  // Скользящая подсветка активного пункта
  const itemRefs = useRef<Map<string, HTMLAnchorElement | null>>(new Map())
  const [indicator, setIndicator] = useState<{ top: number; height: number; visible: boolean }>({
    top: 0, height: 0, visible: false,
  })
  const [animate, setAnimate] = useState(false)

  const activeHref = (() => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (role && item.roles.includes(role) && isActiveLink(pathname, item.href, item.exact)) {
          return item.href
        }
      }
    }
    return null
  })()

  useLayoutEffect(() => {
    const el = activeHref ? itemRefs.current.get(activeHref) : null
    if (el) {
      setIndicator({ top: el.offsetTop, height: el.offsetHeight, visible: true })
      // включаем плавность только после первой установки позиции
      const id = requestAnimationFrame(() => setAnimate(true))
      return () => cancelAnimationFrame(id)
    } else {
      setIndicator(prev => ({ ...prev, visible: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref, role, collapsed])

  // На мобильном: закрывать drawer при переходе на другую страницу
  useEffect(() => {
    onClose?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const width = collapsed ? WIDTH_COLLAPSED : WIDTH_OPEN

  return (
    <>
      {/* Панель fixed, поэтому отдельная колонка резервирует её ширину. */}
      <div
        aria-hidden
        className={cn('hidden flex-shrink-0 md:block', ready && 'transition-[width] duration-200 ease-out')}
        style={{ width }}
      />

      <aside
        className={cn(
          'flex flex-col h-screen overflow-hidden',
          'fixed inset-y-0 left-0 z-50 md:translate-x-0',
          ready && 'transition-transform duration-200 ease-out md:transition-[width]',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
        style={{
          width: mobileOpen ? WIDTH_OPEN : width,
          background: 'linear-gradient(180deg, rgba(30,21,54,0.92) 0%, rgba(14,10,26,0.95) 100%)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          borderRight: '1px solid var(--line)',
          boxShadow: '8px 0 40px -18px rgba(124, 58, 237, 0.35)',
        }}
      >
        {/* Свечение вверху панели — тот же приём, что на витрине: источник
            света у логотипа, а не равномерная заливка. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2"
          style={{
            width: 200,
            height: 140,
            background: 'radial-gradient(circle, rgba(124,58,237,0.30), transparent 70%)',
            filter: 'blur(24px)',
          }}
        />

        {/* Логотип */}
        <div
          className={cn(
            'relative flex flex-shrink-0 items-center gap-2.5 py-4',
            collapsed && !mobileOpen ? 'justify-center px-0' : 'px-4',
          )}
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <div className="brand-mark flex-shrink-0" style={{ width: 32, height: 32 }} aria-hidden />
          {showLabels && (
            <>
              <div className="min-w-0 flex-1">
                <p className="brand-wordmark truncate whitespace-nowrap text-white" style={{ fontSize: 14 }}>
                  smilekit
                </p>
                <p style={{ fontSize: 11, color: 'var(--ink-3)' }} className="truncate whitespace-nowrap">
                  CRM система
                </p>
              </div>
              <button
                onClick={toggleCollapsed}
                title="Свернуть меню"
                className="hidden shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] md:block"
                style={{ color: 'var(--ink-3)' }}
              >
                <PanelLeftClose size={16} />
              </button>
            </>
          )}
        </div>

        {/* Кнопка раскрытия в свёрнутом состоянии — отдельной строкой,
            чтобы не тесниться рядом с логотипом. */}
        {collapsed && !mobileOpen && (
          <button
            onClick={toggleCollapsed}
            title="Развернуть меню"
            className="mx-auto mt-2 hidden rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] md:block"
            style={{ color: 'var(--ink-3)' }}
          >
            <PanelLeftOpen size={16} />
          </button>
        )}

        {/* Навигация */}
        <nav className="flex-1 overflow-y-auto px-2 py-3" style={{ scrollbarWidth: 'none' }}>
          <div className="relative">
            {/* Скользящая подсветка активного пункта */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: indicator.top,
                height: indicator.height,
                background: 'linear-gradient(135deg, var(--accent-from), var(--accent-deep))',
                borderRadius: 10,
                boxShadow: '0 6px 22px -6px var(--accent-shadow), inset 0 0 0 1px rgba(255,255,255,0.14)',
                opacity: indicator.visible ? 1 : 0,
                transition: animate
                  ? 'top 260ms cubic-bezier(0.22,1,0.36,1), height 260ms cubic-bezier(0.22,1,0.36,1), opacity 150ms ease'
                  : 'opacity 150ms ease',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
            {NAV_GROUPS.map((group) => {
              const visible = group.items.filter((item) => role && item.roles.includes(role))
              if (!visible.length) return null

              return (
                <div key={group.label} className="mb-5">
                  {showLabels ? (
                    <p
                      className="mb-1 truncate whitespace-nowrap px-2 font-semibold uppercase tracking-widest"
                      style={{ fontSize: 10, color: 'var(--ink-4)' }}
                    >
                      {group.label}
                    </p>
                  ) : (
                    // В свёрнутом виде подпись группы не помещается — вместо
                    // неё разделительная черта, чтобы блоки не слипались.
                    <div className="mx-3 mb-2 h-px" style={{ background: 'var(--line)' }} aria-hidden />
                  )}
                  <ul className="space-y-0.5">
                    {visible.map((item) => {
                      const active = isActiveLink(pathname, item.href, item.exact)
                      const Icon = item.icon

                      return (
                        <li key={item.href}>
                          <Link
                            ref={(el) => { itemRefs.current.set(item.href, el) }}
                            href={item.href}
                            // По умолчанию Next.js префетчит данные КАЖДОЙ ссылки
                            // в сайдбаре (20+ пунктов), едва они попадают в
                            // вьюпорт — на каждую навигацию это залповая нагрузка
                            // на сервер, под которой другие запросы (например
                            // server actions вроде переключателя бота) могут
                            // зависать без ответа и без ошибки, блокируя UI
                            // до перезагрузки страницы (см. AmoBotToggle).
                            prefetch={false}
                            title={showLabels ? undefined : item.label}
                            className={cn(
                              'relative flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 outline-none transition-colors duration-150',
                              collapsed && !mobileOpen && 'justify-center',
                              active
                                ? 'font-medium text-white'
                                : 'text-[var(--ink-2)] hover:bg-white/[0.06] hover:text-white focus-visible:bg-white/[0.06] focus-visible:text-white',
                            )}
                            style={{ zIndex: 1 }}
                          >
                            <Icon
                              style={{
                                width: 17,
                                height: 17,
                                flexShrink: 0,
                                color: active ? '#ffffff' : 'var(--ink-3)',
                              }}
                            />
                            {showLabels && (
                              <span
                                className="truncate whitespace-nowrap"
                                style={{ fontSize: 13, fontWeight: active ? 500 : 400 }}
                              >
                                {item.label}
                              </span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </nav>

        {/* Пользователь */}
        <div className="flex-shrink-0 px-3 py-3" style={{ borderTop: '1px solid var(--line)' }}>
          <div className={cn('flex items-center gap-2.5', collapsed && !mobileOpen && 'justify-center')}>
            <div
              className="brand-gradient flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white"
              style={{ width: 30, height: 30, fontSize: 11 }}
              title={showLabels ? undefined : (user?.name ?? '')}
            >
              {user?.name ? getInitials(user.name) : '??'}
            </div>

            {showLabels && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate whitespace-nowrap font-medium text-white" style={{ fontSize: 12 }}>
                    {user?.name ?? 'Загрузка...'}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--ink-3)' }} className="truncate whitespace-nowrap">
                    {role ? ROLE_LABELS[role] : ''}
                  </p>
                </div>

                <button
                  onClick={() => signOut()}
                  className="flex-shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/[0.08]"
                  style={{ color: 'var(--ink-3)' }}
                  title="Выйти"
                >
                  <LogOut style={{ width: 15, height: 15 }} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
