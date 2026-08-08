import { AlertTriangle } from 'lucide-react'

/** Бот недоступен или интеграция не настроена — показываем его текст ошибки. */
export function SmilekitBotApiError({ error }: { error: string }) {
  return (
    <div className="p-4 md:p-8">
      <div
        className="flex max-w-xl items-start gap-3 rounded-2xl bg-white p-5"
        style={{ border: '1px solid var(--line)' }}
      >
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--brand-ink)' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Нет связи с ботом Smilekit
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            {error}
          </p>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            Раздел работает через внутренний API бота (aiogram, /internal/*): нужны SMILEKIT_BOT_API_URL и
            SMILEKIT_BOT_INTERNAL_TOKEN, и сам бот должен быть запущен.
          </p>
        </div>
      </div>
    </div>
  )
}
