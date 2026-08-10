'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Bot, MessageCircle, Pause, Play, Send, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  getBotChatMessages,
  getBotChats,
  pauseBotChat,
  resumeBotChat,
  sendOperatorMessage,
} from '@/actions/smilekit-dialogs'
import type {
  SmilekitChatMessage,
  SmilekitChatSummary,
  SmilekitMessageSender,
} from '@/lib/models/smilekit-bot'

const POLL_INTERVAL_MS = 5000

const SENDER_META: Record<SmilekitMessageSender, { label: string; color: string; bg: string }> = {
  client: { label: 'Клиент', color: '#0369a1', bg: '#e0f2fe' },
  bot: { label: 'Бот', color: '#7c3aed', bg: '#ede9fe' },
  operator: { label: 'Менеджер', color: '#15803d', bg: '#dcfce7' },
}

function formatTime(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SmilekitDialogsClient() {
  const [chats, setChats] = useState<SmilekitChatSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [messages, setMessages] = useState<SmilekitChatMessage[]>([])
  const [paused, setPaused] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, startBusy] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<number | null>(null)
  selectedRef.current = selected

  const refreshChats = useCallback(async () => {
    const result = await getBotChats()
    if (!result.success) {
      setError(result.error)
      return
    }
    setError(null)
    setChats(result.chats)
  }, [])

  const refreshThread = useCallback(async (chatId: number) => {
    const result = await getBotChatMessages(chatId)
    if (!result.success || selectedRef.current !== chatId) return
    setMessages(result.messages)
    setPaused(result.paused)
  }, [])

  useEffect(() => {
    refreshChats()
    const id = setInterval(() => {
      refreshChats()
      if (selectedRef.current != null) refreshThread(selectedRef.current)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refreshChats, refreshThread])

  useEffect(() => {
    if (selected == null) return
    setMessages([])
    refreshThread(selected)
  }, [selected, refreshThread])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function handleSend() {
    if (selected == null || !draft.trim()) return
    startBusy(async () => {
      const result = await sendOperatorMessage(selected, draft)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDraft('')
      toast.success('Отправлено. Бот в этом чате на паузе — ведёте вы.')
      await refreshThread(selected)
      await refreshChats()
    })
  }

  function handleTogglePause() {
    if (selected == null) return
    startBusy(async () => {
      const result = paused ? await resumeBotChat(selected) : await pauseBotChat(selected)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(paused ? 'Бот снова отвечает в этом чате' : 'Бот на паузе — чат ведёте вы')
      await refreshThread(selected)
      await refreshChats()
    })
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-8">
      <div>
        <div className="kicker">Telegram-бот Smilekit</div>
        <h1 className="block-title" style={{ marginTop: 7 }}>
          Диалоги
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-3)' }}>
          Вся переписка бота с клиентами. Видно, чей каждый ответ — бота или менеджера. Ручной ответ
          автоматически ставит бота на паузу в этом чате.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl bg-white p-4 text-sm" style={{ border: '1px solid var(--line)', color: '#b91c1c' }}>
          Ошибка связи с ботом: {error}
        </div>
      )}

      <div className="flex gap-4" style={{ minHeight: 520 }}>
        <div
          className="w-72 shrink-0 overflow-y-auto rounded-2xl bg-white"
          style={{ border: '1px solid var(--line)', maxHeight: 640 }}
        >
          {chats.length === 0 ? (
            <p className="p-4 text-sm" style={{ color: 'var(--ink-3)' }}>
              Пока нет ни одного диалога.
            </p>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.chatId}
                onClick={() => setSelected(chat.chatId)}
                className="block w-full px-4 py-3 text-left"
                style={{
                  borderBottom: '1px solid var(--line)',
                  background: selected === chat.chatId ? 'var(--surface-3)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                    <MessageCircle size={13} style={{ color: 'var(--brand-ink)' }} />
                    Чат {chat.chatId}
                  </span>
                  {chat.paused && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: '#fef3c7', color: '#b45309' }}
                    >
                      менеджер
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs" style={{ color: 'var(--ink-3)' }}>
                  {chat.lastText || '—'}
                </p>
                <p className="mt-0.5 text-[10px]" style={{ color: 'var(--ink-3)' }}>
                  {formatTime(chat.lastAt)}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col rounded-2xl bg-white" style={{ border: '1px solid var(--line)' }}>
          {selected == null ? (
            <p className="p-6 text-sm" style={{ color: 'var(--ink-3)' }}>
              Выберите диалог слева.
            </p>
          ) : (
            <>
              <div
                className="flex items-center justify-between gap-3 px-5 py-3"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  Чат {selected}
                </span>
                <Button variant="ghost" onClick={handleTogglePause} disabled={busy} className="gap-1.5">
                  {paused ? <Play size={14} /> : <Pause size={14} />}
                  {paused ? 'Включить бота' : 'Взять на себя'}
                </Button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4" style={{ maxHeight: 460 }}>
                {messages.map((message) => {
                  const meta = SENDER_META[message.sender]
                  const isClient = message.sender === 'client'
                  return (
                    <div key={message.id} className={`mb-3 flex ${isClient ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className="max-w-[75%] rounded-2xl px-3.5 py-2.5"
                        style={{ background: isClient ? 'var(--surface-3)' : meta.bg }}
                      >
                        <div className="mb-1 flex items-center gap-1.5">
                          {message.sender === 'bot' ? (
                            <Bot size={11} style={{ color: meta.color }} />
                          ) : (
                            <User size={11} style={{ color: meta.color }} />
                          )}
                          <span className="text-[10px] font-semibold" style={{ color: meta.color }}>
                            {meta.label}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                            {formatTime(message.createdAt)}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--ink)' }}>
                          {message.content}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                <Textarea
                  value={draft}
                  rows={2}
                  placeholder="Ответить клиенту как менеджер… (бот встанет на паузу)"
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={busy}
                  className="resize-none text-sm"
                />
                <Button onClick={handleSend} disabled={busy || !draft.trim()} className="gap-1.5">
                  <Send size={14} />
                  Отправить
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
