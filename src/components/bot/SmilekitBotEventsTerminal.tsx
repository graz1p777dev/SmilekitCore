'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'lucide-react'
import { getBotEvents } from '@/actions/smilekit-bot-settings'
import type { SmilekitBotEvent } from '@/lib/models/smilekit-bot'

const POLL_INTERVAL_MS = 4000
const MAX_LINES = 300

const LEVEL_COLOR: Record<SmilekitBotEvent['level'], string> = {
  info: '#7dd3fc',
  warn: '#facc15',
  error: '#fca5a5',
}

function formatTime(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDetails(details: SmilekitBotEvent['details']): string {
  if (!details) return ''
  return Object.entries(details)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
    .slice(0, 300)
}

export function SmilekitBotEventsTerminal() {
  const [events, setEvents] = useState<SmilekitBotEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const sinceIdRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      const result = await getBotEvents(sinceIdRef.current)
      if (!alive) return
      if (!result.success) {
        setError(result.error)
        return
      }
      setError(null)
      if (result.events.length === 0) return
      // Бот отдаёт новые сверху (id DESC) — для терминала нужен хронологический порядок.
      const chronological = [...result.events].reverse()
      sinceIdRef.current = Math.max(sinceIdRef.current, ...result.events.map((e) => e.id))
      setEvents((prev) => [...prev, ...chronological].slice(-MAX_LINES))
    }
    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const keepBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (keepBottom) el.scrollTop = el.scrollHeight
  }, [events])

  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--line)' }}>
      <div className="flex items-center gap-2.5 px-5 py-4" style={{ backgroundColor: '#17102a' }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--brand-ink)' }}>
          <Terminal size={15} color="#ffffff" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Живой журнал бота</h2>
          <p className="text-xs" style={{ color: '#9a93a8' }}>
            Что бот делает прямо сейчас — обновляется каждые {POLL_INTERVAL_MS / 1000} сек.
          </p>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed"
        style={{ backgroundColor: '#0d0a16', height: 340 }}
      >
        {error ? (
          <p style={{ color: '#fca5a5' }}>Ошибка: {error}</p>
        ) : events.length === 0 ? (
          <p style={{ color: '#6b6480' }}>$ Ожидаем события бота…</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="flex flex-wrap gap-2 py-0.5" style={{ color: '#d4d0dc' }}>
              <span style={{ color: '#6b6480' }}>{formatTime(event.createdAt)}</span>
              <b style={{ color: LEVEL_COLOR[event.level] }}>{event.level.toUpperCase()}</b>
              <span style={{ color: '#a78bfa' }}>{event.stage}</span>
              {event.chatId != null && <span style={{ color: '#6b6480' }}>chat={event.chatId}</span>}
              <span>{event.message || event.event}</span>
              {formatDetails(event.details) && (
                <code style={{ color: '#6b6480' }}>{formatDetails(event.details)}</code>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
