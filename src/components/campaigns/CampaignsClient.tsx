'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CheckCircle2, Clock3, Send, ShieldCheck, ShieldX, Trash2, UsersRound, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  addOptOutPhone,
  cancelCampaign,
  removeOptOutPhone,
  scheduleCampaign,
  type CampaignsData,
  type CampaignRow,
} from '@/actions/campaigns'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const statusMeta: Record<CampaignRow['status'], { label: string; color: string; bg: string }> = {
  scheduled: { label: 'Запланирована', color: '#6d28d9', bg: '#f0e8ff' },
  running: { label: 'Отправляется', color: '#9a6700', bg: '#fff5cc' },
  completed: { label: 'Завершена', color: '#087a55', bg: '#ddf8ed' },
  cancelled: { label: 'Отменена', color: '#6b6570', bg: '#f1eef3' },
  failed: { label: 'Ошибка', color: '#b42318', bg: '#fee4e2' },
}

function defaultSchedule() {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-KG', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek',
  }).format(new Date(value))
}

export default function CampaignsClient({ initialData }: { initialData: CampaignsData }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [scheduledAt, setScheduledAt] = useState(defaultSchedule)
  const [optOutPhone, setOptOutPhone] = useState('')
  const [optOutReason, setOptOutReason] = useState('')

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(timer)
  }, [router])

  const scheduleLabel = useMemo(() => {
    const date = new Date(scheduledAt)
    return Number.isNaN(date.getTime()) ? 'Выберите время' : formatDate(date.toISOString())
  }, [scheduledAt])

  function submit() {
    startTransition(async () => {
      const result = await scheduleCampaign({ title, message, scheduledAt: new Date(scheduledAt).toISOString() })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Рассылка запланирована для ${result.count} клиентов`)
      setTitle('')
      setMessage('')
      setScheduledAt(defaultSchedule())
      router.refresh()
    })
  }

  function cancel(id: string) {
    startTransition(async () => {
      const result = await cancelCampaign(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Рассылка отменена')
      router.refresh()
    })
  }

  function addOptOut() {
    const phone = optOutPhone.trim()
    if (!phone) return
    startTransition(async () => {
      const result = await addOptOutPhone(phone, optOutReason)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Номер добавлен в стоп-список рассылок')
      setOptOutPhone('')
      setOptOutReason('')
      router.refresh()
    })
  }

  function removeOptOut(phone: string) {
    startTransition(async () => {
      const result = await removeOptOutPhone(phone)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Номер убран из стоп-списка')
      router.refresh()
    })
  }

  const valid = title.trim() && message.trim() && scheduledAt && initialData.eligibleCount > 0

  return (
    <div className="min-h-full" style={{ background: 'var(--surface-2)' }}>
      <PageHeader title="Рассылки" subtitle="Возвращайте клиентов, которые ещё не купили" />
      <main className="mx-auto max-w-6xl p-4 md:p-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]">
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 md:p-7">
            <div className="mb-6 flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl text-white" style={{ background: 'linear-gradient(145deg,#6f2bd0,#48108f)' }}>
                <Send className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Новая рассылка</h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>Сообщение уйдёт в выбранное время по Бишкеку.</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="campaign-title">Название для CRM</Label>
                <Input id="campaign-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Скидка выходного дня" maxLength={160} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="campaign-message">Сообщение клиенту</Label>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>{message.length}/4000</span>
                </div>
                <Textarea id="campaign-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Напишите текст акции…" maxLength={4000} className="min-h-44 resize-y leading-relaxed" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-time">Дата и время</Label>
                <Input id="campaign-time" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
              </div>
              <Button size="lg" className="w-full" disabled={!valid || pending} onClick={submit}>
                <CalendarClock /> {pending ? 'Сохраняем…' : 'Запланировать рассылку'}
              </Button>
            </div>
          </section>

          <aside className="overflow-hidden rounded-3xl text-white shadow-[0_18px_50px_-24px_rgba(78,20,150,.7)]" style={{ background: 'linear-gradient(155deg,#5c18b5 0%,#39106f 100%)' }}>
            <div className="p-6">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-white/60">Аудитория</p>
              <div className="mt-4 flex items-end gap-2">
                <strong className="text-5xl leading-none tabular-nums">{initialData.eligibleCount}</strong>
                <span className="pb-1 text-sm text-white/70">клиентов</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-white/75">Сделки без оплаченного заказа в Telegram, WhatsApp и Instagram.</p>
            </div>
            <div className="border-y border-white/10 bg-white/[.06] p-6">
              <div className="flex gap-3"><Clock3 className="mt-0.5 size-4 shrink-0 text-violet-200" /><div><p className="text-xs text-white/55">Отправка</p><p className="mt-1 text-sm font-semibold">{scheduleLabel}</p></div></div>
            </div>
            <div className="space-y-3 p-6 text-sm text-white/75">
              <div className="flex gap-3"><ShieldCheck className="size-4 shrink-0 text-emerald-300" /><span>Купившие автоматически исключены</span></div>
              <div className="flex gap-3"><UsersRound className="size-4 shrink-0 text-emerald-300" /><span>Диалоги менеджеров не затрагиваются</span></div>
              <div className="flex gap-3"><CheckCircle2 className="size-4 shrink-0 text-emerald-300" /><span>Повторная отправка одному клиенту заблокирована</span></div>
            </div>
          </aside>
        </div>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>История рассылок</h2>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>обновляется автоматически</span>
          </div>
          <div className="space-y-3">
            {initialData.campaigns.length === 0 && (
              <div className="rounded-2xl bg-white px-5 py-10 text-center text-sm ring-1 ring-black/5" style={{ color: 'var(--ink-3)' }}>Рассылок пока нет</div>
            )}
            {initialData.campaigns.map((campaign) => {
              const meta = statusMeta[campaign.status]
              return (
                <article key={campaign.id} className="grid gap-4 rounded-2xl bg-white p-5 ring-1 ring-black/5 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold" style={{ color: 'var(--ink)' }}>{campaign.title}</h3>
                      <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                    </div>
                    <p className="mt-1 truncate text-sm" style={{ color: 'var(--ink-3)' }}>{campaign.message}</p>
                  </div>
                  <div className="text-sm tabular-nums md:text-right">
                    <p className="font-semibold" style={{ color: 'var(--ink)' }}>{formatDate(campaign.scheduled_at)}</p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>отправлено {campaign.sent_count}/{campaign.recipient_count}{campaign.failed_count ? ` · ошибок ${campaign.failed_count}` : ''}</p>
                  </div>
                  {campaign.status === 'scheduled' ? (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => cancel(campaign.id)}><XCircle /> Отменить</Button>
                  ) : <div className="hidden w-20 md:block" />}
                </article>
              )
            })}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <ShieldX className="size-4" style={{ color: 'var(--ink-3)' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>Стоп-список рассылок</h2>
          </div>
          <p className="mb-3 text-sm" style={{ color: 'var(--ink-3)' }}>
            Номера здесь никогда не попадут в аудиторию рассылки — даже если ещё не купили.
          </p>
          <div className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <Input
                value={optOutPhone}
                onChange={(event) => setOptOutPhone(event.target.value)}
                placeholder="Номер телефона, 996…"
              />
              <Input
                value={optOutReason}
                onChange={(event) => setOptOutReason(event.target.value)}
                placeholder="Причина (необязательно)"
              />
              <Button disabled={!optOutPhone.trim() || pending} onClick={addOptOut}>
                <ShieldX /> Добавить
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {initialData.optOuts.length === 0 && (
                <p className="py-4 text-center text-sm" style={{ color: 'var(--ink-3)' }}>Стоп-список пуст</p>
              )}
              {initialData.optOuts.map((row) => (
                <div key={row.phone} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
                  <div className="min-w-0">
                    <p className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>+{row.phone}</p>
                    {row.reason && <p className="truncate text-xs" style={{ color: 'var(--ink-3)' }}>{row.reason}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeOptOut(row.phone)}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" /> Убрать
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
