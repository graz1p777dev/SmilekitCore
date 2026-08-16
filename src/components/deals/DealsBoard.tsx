'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { GripVertical, Plus, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/formatters'
import type { Deal, DealEmployee, DealStage, DealViewer } from '@/types'
import { getDealsData, moveDeal, reconcileDealsFromShop } from '@/actions/deals'
import { renameStage, reorderStages, updateStageDescription } from '@/actions/stages'
import { stageSoft } from './deal-config'
import DealCard from './DealCard'
import DealModal from './DealModal'
import CustomerCardModal from './CustomerCardModal'
import { AmoBotToggle } from './AmoBotToggle'

interface Props {
  initialStages: DealStage[]
  initialDeals: Deal[]
  employees: DealEmployee[]
  me: DealViewer
  /** Открыть карточку сразу при загрузке — переход со страницы «Заказы». */
  initialOpenDealId?: string | null
}

interface ModalState {
  open: boolean
  deal: Deal | null
  isNew: boolean
  stageId: string
}

/** Итог колонки: сумма по валютам, поэтому не одно число, а несколько. */
function columnTotals(deals: Deal[]): string[] {
  const byCurrency = new Map<string, number>()
  for (const d of deals) {
    if (d.amount === null) continue
    byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + Number(d.amount))
  }
  return [...byCurrency.entries()].map(([currency, sum]) => formatMoney(sum, currency))
}

export default function DealsBoard({ initialStages, initialDeals, employees, me, initialOpenDealId }: Props) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ModalState>({
    open: false, deal: null, isNew: false, stageId: '',
  })
  const [syncing, startSync] = useTransition()

  // Переход со страницы «Заказы» — открываем карточку сразу, не дожидаясь
  // клика по колонке. Зависимость от initialOpenDealId обязательна: при
  // клиентской навигации (Link) на тот же /dashboard/deals с новым ?deal=
  // React переиспользует уже смонтированный DealsBoard, а не пересоздаёт
  // его — эффект с пустым []-массивом зависимостей срабатывал только на
  // первый заход и не реагировал на смену параметра в URL при последующих
  // переходах (кнопка «Написать →» из заказа работала только после
  // жёсткой перезагрузки страницы, где компонент действительно монтируется
  // заново).
  useEffect(() => {
    if (!initialOpenDealId) return
    const target = initialDeals.find((d) => d.id === initialOpenDealId)
    if (target) setModal({ open: true, deal: target, isNew: false, stageId: target.stage_id })
  }, [initialOpenDealId, initialDeals])

  // Этапы — состояние, а не константа: владелец перетаскивает колонки
  // прямо на доске (как настройка воронки в amoCRM).
  const [stages, setStages] = useState<DealStage[]>(initialStages)
  const [dragStageId, setDragStageId] = useState<string | null>(null)
  const [customerPhone, setCustomerPhone] = useState<string | null>(null)
  const canEditStages = me.role === 'owner'
  const defaultStageId = useMemo(
    () => stages.find((s) => s.is_default)?.id ?? stages[0]?.id ?? '',
    [stages]
  )

  /** Колонку бросили на колонку targetId — этап встаёт на её место. */
  const dropStage = (targetId: string) => {
    const fromId = dragStageId
    setDragStageId(null)
    if (!fromId || fromId === targetId) return
    const snapshot = stages
    const next = [...stages]
    const from = next.findIndex((s) => s.id === fromId)
    const to = next.findIndex((s) => s.id === targetId)
    if (from < 0 || to < 0) return
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setStages(next)
    void reorderStages(next.map((s) => s.id)).then((res) => {
      if (!res.success) {
        toast.error(res.error)
        setStages(snapshot)
      }
    })
  }

  // Realtime-подписка живёт вне рендера, а знать о текущем перетаскивании ей
  // нужно — держим id и в состоянии (для отрисовки), и в ref (для колбэка).
  const dragIdRef = useRef<string | null>(null)
  const beginDrag = (id: string) => {
    dragIdRef.current = id
    setDragId(id)
  }

  const employeeMap = useMemo(() => {
    const m = new Map<string, DealEmployee>()
    for (const e of employees) m.set(e.id, e)
    return m
  }, [employees])

  const refresh = useCallback(async () => {
    const data = await getDealsData()
    setDeals(data.deals)
  }, [])

  // ─── Сверка с витриной ─────────────────────────────────────────────────────
  // Push от витрины может потеряться (CRM перезапускалась, сеть моргнула),
  // поэтому сверяемся при открытии страницы и по кнопке.
  const sync = useCallback(
    (silent: boolean) =>
      startSync(async () => {
        const res = await reconcileDealsFromShop()
        if (!res.success) {
          if (!silent) toast.error(res.error)
          return
        }
        await refresh()
        if (!silent) {
          toast.success(
            res.data?.created
              ? `Добавлено сделок: ${res.data.created}`
              : 'Новых диалогов нет — всё уже в воронке'
          )
        }
      }),
    [refresh]
  )

  useEffect(() => {
    sync(true)
    // Разовая сверка при открытии страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel('deals-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        if (dragIdRef.current) return // не мешаем текущему перетаскиванию
        if (timer) clearTimeout(timer)
        timer = setTimeout(refresh, 400)
      })
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [refresh])

  // ─── Фильтрация и раскладка по колонкам ────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return deals
    return deals.filter((d) =>
      `${d.title} ${d.customer_name ?? ''} ${d.customer_phone ?? ''} ${d.customer_username ?? ''} ${d.city ?? ''} ${d.address ?? ''}`
        .toLowerCase()
        .includes(q)
    )
  }, [deals, search])

  const columns = useMemo(() => {
    const map = new Map<string, Deal[]>()
    for (const s of stages) map.set(s.id, [])
    for (const d of filtered) map.get(d.stage_id)?.push(d)
    return map
  }, [filtered, stages])

  // ─── Перетаскивание ────────────────────────────────────────────────────────
  const endDrag = () => {
    dragIdRef.current = null
    setDragId(null)
    setDragOverStage(null)
  }

  const performDrop = async (toStageId: string) => {
    const id = dragId
    endDrag()
    if (!id) return

    const moving = deals.find((d) => d.id === id)
    if (!moving || moving.stage_id === toStageId) return

    const snapshot = deals
    const movedAt = new Date().toISOString()
    setDeals((prev) =>
      prev.map((d) => (d.id === id ? { ...d, stage_id: toStageId, stage_changed_at: movedAt } : d))
    )

    const res = await moveDeal(id, toStageId)
    if (!res.success) {
      toast.error(res.error)
      setDeals(snapshot) // откат
    }
  }

  const openNew = (stageId: string) =>
    setModal({ open: true, deal: null, isNew: true, stageId })
  const openEdit = (deal: Deal) =>
    setModal({ open: true, deal, isNew: false, stageId: deal.stage_id })
  const closeModal = () => setModal((m) => ({ ...m, open: false }))

  return (
    <div className="flex h-[calc(100vh-52px)] flex-col">
      {/* Заголовок и панель */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <p className="kicker">Воронка продаж</p>
          <h1 className="block-title">Сделки</h1>
          <span className="span-rule" aria-hidden />
          <p className="mt-1.5 text-[13px] text-gray-400">
            {me.role === 'owner' || me.role === 'rop'
              ? `Все сделки магазина · ${deals.length}`
              : `Ваши сделки · ${deals.length}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AmoBotToggle />
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Клиент, телефон, название…"
              className="h-9 w-56 rounded-xl border border-gray-200 bg-card/80 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-gray-300"
            />
          </div>

          <button
            onClick={() => sync(false)}
            disabled={syncing}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-card/80 px-3 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60"
            title="Забрать новые диалоги с витрины"
          >
            <RefreshCw size={15} className={cn(syncing && 'animate-spin')} />
            Синхронизировать
          </button>

          <button
            onClick={() => openNew(defaultStageId)}
            className="flex h-9 items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold text-white brand-gradient brand-shadow transition-transform hover:-translate-y-0.5"
          >
            <Plus size={16} />
            Создать сделку
          </button>
        </div>
      </div>

      {/* Доска */}
      <div className="flex flex-1 gap-4 overflow-x-auto px-6 pb-6 scroll-hidden">
        {stages.map((stage) => {
          const list = columns.get(stage.id) ?? []
          const totals = columnTotals(list)
          const isTarget = dragOverStage === stage.id
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                if (!dragId && !dragStageId) return
                e.preventDefault()
                if (dragId) setDragOverStage(stage.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragStageId) {
                  dropStage(stage.id)
                  return
                }
                void performDrop(stage.id)
              }}
              className={cn(
                'flex w-[290px] shrink-0 flex-col rounded-2xl border transition-colors',
                dragStageId === stage.id && 'opacity-60',
                isTarget && dragId
                  ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                  : 'border-[var(--line)] bg-[var(--surface-2)]/50'
              )}
              style={{ borderTop: `2px solid ${stage.color}` }}
            >
              {/* Заголовок колонки. Владелец перетаскивает этап за шапку —
                  порядок воронки правится с доски, как в amoCRM. */}
              <div
                className={cn('px-3 py-3', canEditStages && 'cursor-grab active:cursor-grabbing')}
                draggable={canEditStages}
                onDragStart={(e) => {
                  if (!canEditStages) return
                  e.stopPropagation()
                  setDragStageId(stage.id)
                }}
                onDragEnd={() => setDragStageId(null)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {canEditStages && (
                      <GripVertical size={13} className="shrink-0 opacity-40" style={{ color: 'var(--ink-4)' }} />
                    )}
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: stage.color }}
                    />
                    <StageName stage={stage} editable={canEditStages} onRenamed={(name) =>
                      setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, name } : s)))
                    } />
                    <span
                      className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold"
                      style={{ color: stage.color, background: stageSoft(stage.color) }}
                    >
                      {list.length}
                    </span>
                  </div>
                  <button
                    onClick={() => openNew(stage.id)}
                    className="rounded-lg p-1 transition-colors hover:bg-[var(--surface-3)]"
                    style={{ color: 'var(--ink-4)' }}
                    title="Добавить в этап"
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <StageDescription stage={stage} editable={canEditStages} onSaved={(description) =>
                  setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, description } : s)))
                } />
                <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--ink-4)' }}>
                  {totals.length ? totals.join(' · ') : 'Без суммы'}
                </p>
              </div>

              {/* Карточки */}
              <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3 scroll-hidden">
                {list.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    employees={employeeMap}
                    stageColor={stage.color}
                    dragging={dragId === deal.id}
                    onDragStart={() => beginDrag(deal.id)}
                    onDragEnd={endDrag}
                    onClick={() => openEdit(deal)}
                  />
                ))}

                {dragId && isTarget && <div className="h-[3px] rounded-full bg-[var(--brand)]" />}

                {list.length === 0 && !dragId && (
                  <button
                    onClick={() => openNew(stage.id)}
                    className="w-full rounded-xl border border-dashed border-gray-200 py-6 text-center text-[12px] text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-500"
                  >
                    Пусто — добавить сделку
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {modal.open && (
        <DealModal
          deal={modal.deal}
          isNew={modal.isNew}
          defaultStageId={modal.stageId || defaultStageId}
          stages={stages}
          employees={employees}
          me={me}
          onClose={closeModal}
          onSaved={refresh}
          onOpenCustomer={(phone) => setCustomerPhone(phone)}
        />
      )}

      {customerPhone && (
        <CustomerCardModal
          key={customerPhone}
          phone={customerPhone}
          stages={stages}
          onClose={() => setCustomerPhone(null)}
          onOpenDeal={(dealId) => {
            setCustomerPhone(null)
            const target = deals.find((d) => d.id === dealId)
            if (target) setModal({ open: true, deal: target, isNew: false, stageId: target.stage_id })
          }}
        />
      )}
    </div>
  )
}

// ─── Настройка этапа с доски ────────────────────────────────────────────────

/** Название: двойной клик — переименовать (только владелец). */
function StageName({ stage, editable, onRenamed }: {
  stage: DealStage
  editable: boolean
  onRenamed: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stage.name)

  if (!editing) {
    return (
      <span
        className="truncate text-[13px] font-semibold"
        style={{ color: 'var(--ink-2)' }}
        onDoubleClick={() => {
          if (!editable) return
          setDraft(stage.name)
          setEditing(true)
        }}
        title={editable ? 'Двойной клик — переименовать' : undefined}
      >
        {stage.name}
      </span>
    )
  }

  const commit = () => {
    setEditing(false)
    const value = draft.trim()
    if (!value || value === stage.name) return
    onRenamed(value)
    void renameStage(stage.id, value).then((res) => {
      if (!res.success) {
        toast.error(res.error)
        onRenamed(stage.name)
      }
    })
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="w-full min-w-0 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold outline-none"
      style={{ borderColor: 'var(--brand)', background: 'var(--surface)', color: 'var(--ink)' }}
    />
  )
}

/** Описание этапа: что это за шаг воронки. Клик — редактировать. */
function StageDescription({ stage, editable, onSaved }: {
  stage: DealStage
  editable: boolean
  onSaved: (description: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stage.description ?? '')

  if (!editing) {
    if (!stage.description && !editable) return null
    return (
      <p
        className={cn('mt-1 line-clamp-2 text-[11px] leading-snug', editable && 'cursor-text')}
        style={{ color: stage.description ? 'var(--ink-3)' : 'var(--ink-4)' }}
        onClick={() => {
          if (!editable) return
          setDraft(stage.description ?? '')
          setEditing(true)
        }}
        title={editable ? 'Нажмите, чтобы изменить описание этапа' : stage.description ?? undefined}
      >
        {stage.description || '+ описание этапа'}
      </p>
    )
  }

  const commit = () => {
    setEditing(false)
    const value = draft.trim()
    if (value === (stage.description ?? '')) return
    onSaved(value || null)
    void updateStageDescription(stage.id, value).then((res) => {
      if (!res.success) {
        toast.error(res.error)
        onSaved(stage.description)
      }
    })
  }

  return (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') setEditing(false)
      }}
      rows={2}
      placeholder="Когда сделка попадает в этот этап"
      className="mt-1 w-full resize-none rounded-md border px-1.5 py-1 text-[11px] leading-snug outline-none"
      style={{ borderColor: 'var(--brand)', background: 'var(--surface)', color: 'var(--ink)' }}
    />
  )
}
