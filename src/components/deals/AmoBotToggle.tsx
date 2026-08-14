'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Power } from 'lucide-react'
import { getAmoBotEnabled, setAmoBotEnabled } from '@/actions/amocrm-bot'

/** Аварийный выключатель бота amoCRM — живёт в шапке доски сделок. */
export function AmoBotToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, startBusy] = useTransition()

  useEffect(() => {
    getAmoBotEnabled().then((result) => {
      if (result.success) setEnabled(result.enabled)
    })
  }, [])

  function handleToggle() {
    if (enabled == null) return
    const next = !enabled
    startBusy(async () => {
      // Сервер иногда не отвечает вовсе — не ошибкой, а зависшим запросом
      // (см. префетч в Sidebar.tsx: залповая нагрузка при навигации может
      // подвесить параллельный запрос без таймаута и без ответа). Без гонки
      // с таймаутом кнопка оставалась disabled навсегда, до жёсткой
      // перезагрузки страницы — busy никогда не сбрасывался.
      const timedOut = Symbol('timeout')
      const result = await Promise.race([
        setAmoBotEnabled(next),
        new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 10_000)),
      ])
      if (result === timedOut) {
        toast.error('Сервер не ответил — попробуйте ещё раз через несколько секунд')
        return
      }
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setEnabled(next)
      toast.success(next ? 'Бот amoCRM включён — отвечает клиентам' : 'Бот amoCRM ВЫКЛЮЧЕН — молчит во всех чатах')
    })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={busy || enabled == null}
      className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition-colors disabled:opacity-60"
      style={
        enabled
          ? { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }
          : { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }
      }
      title="Мгновенно глушит ответы бота в WhatsApp-чатах amoCRM. История и этапы сделок продолжают вестись."
    >
      <Power size={14} />
      {enabled == null ? 'Бот…' : enabled ? 'Бот: ВКЛ' : 'Бот: ВЫКЛ'}
    </button>
  )
}
