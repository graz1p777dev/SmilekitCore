'use client'

// Песочница для теста Telegram-бота Smilekit: гоняет тот же пайплайн
// SmilekitAssistant (менеджер + супервизор), что и прод, но через
// /internal/lab — отдельную ручку бота, которая не пишет в его SQLite
// (messages/customer_memory/orders/sent_events) и не отправляет ничего в
// Telegram. История переписки живёт только в состоянии этой страницы.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Bot, FlaskConical, RotateCcw, Send, ShieldAlert, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { runBotLab } from '@/actions/smilekit-bot-settings'
import type { SmilekitLabMessage } from '@/lib/models/smilekit-bot'

export default function LaboratoryPage() {
  const [history, setHistory] = useState<SmilekitLabMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    const nextHistory: SmilekitLabMessage[] = [...history, { role: 'user', content: text }]
    setHistory(nextHistory)
    setInput('')
    setLoading(true)
    try {
      const result = await runBotLab(text, history)
      if (!result.success) {
        toast.error(result.error)
        setHistory((prev) => prev.slice(0, -1))
        return
      }
      setHistory((prev) => [...prev, { role: 'assistant', content: result.reply }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-8" style={{ maxWidth: 780 }}>
      <div>
        <div className="kicker">Telegram-бот Smilekit</div>
        <h1 className="block-title" style={{ marginTop: 7 }}>
          Лаборатория
        </h1>
      </div>

      <div
        className="flex items-start gap-2.5 rounded-2xl px-4 py-3"
        style={{ background: 'var(--brand-soft)' }}
      >
        <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--brand-ink)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--brand-ink)' }}>
          Изолировано — ничего не сохраняется и не уходит клиентам. Сообщения проходят через тот же промпт-пайплайн
          бота (менеджер + супервизор), но не пишутся в базу бота и не отправляются в Telegram. История чата живёт
          только в этой вкладке и пропадает при обновлении страницы.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card" style={{ border: '1px solid var(--line)' }}>
        <div className="flex items-center justify-between gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--brand-ink)' }}>
              <FlaskConical size={15} color="#fff" />
            </div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Тестовый чат</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={history.length === 0 || loading}
            onClick={() => setHistory([])}
          >
            <RotateCcw size={13} />
            Очистить
          </Button>
        </div>

        <div className="flex flex-col gap-3 p-4" style={{ minHeight: 220, maxHeight: 520, overflowY: 'auto' }}>
          {history.length === 0 && (
            <p className="mt-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
              Напишите сообщение клиента — бот ответит тем же промптом, что и в проде.
            </p>
          )}
          {history.map((message, index) => (
            <div
              key={index}
              className={`flex max-w-[85%] flex-col gap-1 ${message.role === 'user' ? 'items-start self-start' : 'items-end self-end'}`}
            >
              <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--ink-3)' }}>
                {message.role === 'user' ? (
                  <>
                    <User size={9} /> Тестовый клиент
                  </>
                ) : (
                  <>
                    <Bot size={9} /> Бот
                  </>
                )}
              </div>
              <div
                className="whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm"
                style={
                  message.role === 'user'
                    ? { background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)', borderBottomLeftRadius: 4 }
                    : { background: 'var(--brand-ink)', color: 'var(--on-brand)', borderBottomRightRadius: 4 }
                }
              >
                {message.content}
              </div>
            </div>
          ))}
          {loading && (
            <div
              className="self-start rounded-2xl px-3.5 py-2 text-sm"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink-3)', borderBottomLeftRadius: 4 }}
            >
              печатает…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--line)' }}>
          <Textarea
            rows={2}
            placeholder="Сообщение тестового клиента… (Ctrl+Enter — отправить)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.ctrlKey) send()
            }}
            disabled={loading}
            className="flex-1 resize-none"
          />
          <Button onClick={send} disabled={loading || !input.trim()} className="gap-1.5 self-end">
            <Send size={13} />
            Отправить
          </Button>
        </div>
      </div>
    </div>
  )
}
