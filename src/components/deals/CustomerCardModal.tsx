'use client'

// Карточка клиента — как в amoCRM: человек, а не отдельная сделка.
//
// Открывается из карточки сделки по телефону. Всё собирается по номеру:
// профиль (имя, заметка, теги), сделки клиента по всем этапам, его заказы
// и сумма покупок. Заметка и теги сохраняются в customers и живут отдельно
// от сделок: сделка закрывается, память о клиенте остаётся.

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CircleUserRound, Loader2, NotebookPen, Phone, Plus, ShoppingBag, Tag, X } from 'lucide-react'
import { formatMoney } from '@/lib/formatters'
import { getCustomerCard, saveCustomerProfile, type CustomerCard } from '@/actions/customers'
import type { DealStage } from '@/types'
import { formatStageAge } from './deal-config'

interface Props {
  phone: string
  stages: DealStage[]
  onClose: () => void
  /** Открыть сделку из списка — карточка клиента закрывается сама. */
  onOpenDeal?: (dealId: string) => void
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  shipped: 'Отправлен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
}

export default function CustomerCardModal({ phone, stages, onClose, onOpenDeal }: Props) {
  const [card, setCard] = useState<CustomerCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [name, setName] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [tags, setTags] = useState<string[]>([])

  // Телефон фиксирован на всё время жизни модалки (открытие другого клиента
  // размонтирует её), поэтому загрузка — строго один раз, без синхронного
  // setState в эффекте.
  useEffect(() => {
    let cancelled = false
    getCustomerCard(phone).then((data) => {
      if (cancelled) return
      setCard(data)
      setNote(data?.profile.note ?? '')
      setName(data?.profile.name ?? '')
      setTags(data?.profile.tags ?? [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [phone])

  const stageById = new Map(stages.map((stage) => [stage.id, stage]))

  function save(next?: { tags?: string[] }) {
    startTransition(async () => {
      const result = await saveCustomerProfile(phone, { name, note, tags: next?.tags ?? tags })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Карточка клиента сохранена')
    })
  }

  function addTag() {
    const value = tagDraft.trim()
    if (!value) return
    if (tags.includes(value)) {
      setTagDraft('')
      return
    }
    const next = [...tags, value]
    setTags(next)
    setTagDraft('')
    save({ tags: next })
  }

  function removeTag(tag: string) {
    const next = tags.filter((item) => item !== tag)
    setTags(next)
    save({ tags: next })
  }

  return (
    <div
      // Выше общей Modal (z-9999): карточка клиента открывается ПОВЕРХ
      // карточки сделки, а не позади неё.
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: 'rgba(5, 3, 12, 0.66)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border"
        style={{
          background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
          borderColor: 'var(--line)',
          boxShadow: '0 24px 80px -24px rgba(0,0,0,0.6), 0 0 60px -30px var(--accent-shadow)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-start justify-between gap-3 border-b px-6 py-5" style={{ borderColor: 'var(--line)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}
            >
              <CircleUserRound size={22} />
            </span>
            <div className="min-w-0">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => save()}
                placeholder="Имя клиента"
                className="w-full bg-transparent text-lg font-bold outline-none"
                style={{ color: 'var(--ink)' }}
              />
              <p className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--ink-3)' }}>
                <Phone size={12} /> +{phone}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-3)]"
            style={{ color: 'var(--ink-3)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
              <Loader2 size={16} className="animate-spin" /> Собираем историю клиента…
            </div>
          )}

          {!loading && card && (
            <>
              {/* Итоги */}
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Сделок" value={String(card.deals.length)} />
                <Stat label="Заказов" value={String(card.orders.length)} />
                <Stat
                  label="Куплено на"
                  value={card.totals.length ? card.totals.map((t) => formatMoney(t.amount, t.currency)).join(' · ') : '—'}
                />
              </div>

              {/* Теги */}
              <section>
                <SectionTitle icon={<Tag size={13} />} text="Теги" />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="group flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium"
                      style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}
                    >
                      {tag}
                      <button onClick={() => removeTag(tag)} className="opacity-50 transition-opacity hover:opacity-100">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addTag()
                      }}
                      placeholder="Добавить тег"
                      className="w-28 rounded-full border px-2.5 py-1 text-[12px] outline-none"
                      style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    />
                    <button
                      onClick={addTag}
                      className="rounded-full p-1 transition-colors hover:bg-[var(--surface-3)]"
                      style={{ color: 'var(--ink-3)' }}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              </section>

              {/* Заметка */}
              <section>
                <SectionTitle icon={<NotebookPen size={13} />} text="Заметка о клиенте" />
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  onBlur={() => save()}
                  placeholder="Особенности, договорённости, предпочтения — видно всей команде"
                  className="mt-2 min-h-20 w-full resize-y rounded-2xl border p-3 text-[13px] outline-none"
                  style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                />
                {pending && (
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-4)' }}>
                    Сохраняем…
                  </p>
                )}
              </section>

              {/* Сделки клиента */}
              <section>
                <SectionTitle icon={<CircleUserRound size={13} />} text={`Сделки · ${card.deals.length}`} />
                <div className="mt-2 space-y-2">
                  {card.deals.map((deal) => {
                    const stage = stageById.get(deal.stage_id)
                    return (
                      <button
                        key={deal.id}
                        onClick={() => onOpenDeal?.(deal.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors hover:border-[var(--brand)]"
                        style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                            {deal.title}
                          </p>
                          <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                            в этапе {formatStageAge(deal.stage_changed_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {deal.amount !== null && (
                            <span className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
                              {formatMoney(Number(deal.amount), deal.currency)}
                            </span>
                          )}
                          {stage && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ color: stage.color, background: `color-mix(in srgb, ${stage.color} 16%, transparent)` }}
                            >
                              {stage.name}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                  {card.deals.length === 0 && <Empty text="Сделок пока нет" />}
                </div>
              </section>

              {/* Заказы */}
              <section>
                <SectionTitle icon={<ShoppingBag size={13} />} text={`Заказы · ${card.orders.length}`} />
                <div className="mt-2 space-y-2">
                  {card.orders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5"
                      style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px]" style={{ color: 'var(--ink)' }}>
                          {order.summary?.split('\n')[0] || `Заказ №${order.id.slice(0, 8)}`}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                          {new Date(order.created_at).toLocaleDateString('ru-RU')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {order.total_amount !== null && (
                          <span className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
                            {formatMoney(Number(order.total_amount), order.currency)}
                          </span>
                        )}
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: 'var(--surface-3)', color: 'var(--ink-2)' }}
                        >
                          {ORDER_STATUS_LABELS[order.status] ?? order.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  {card.orders.length === 0 && <Empty text="Заказов пока нет" />}
                </div>
              </section>
            </>
          )}

          {!loading && !card && <Empty text="Не удалось собрать карточку — проверьте номер" />}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border px-3 py-2.5" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--ink-4)' }}>
        {label}
      </p>
      <p className="mt-0.5 truncate text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
        {value}
      </p>
    </div>
  )
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
      {icon} {text}
    </p>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed px-3 py-4 text-center text-[12px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-4)' }}>
      {text}
    </p>
  )
}
