import Link from 'next/link'
import { AlertTriangle, Plug } from 'lucide-react'

/**
 * Бот недоступен или интеграция не настроена.
 *
 * Раньше здесь просто перечислялись имена переменных окружения — человеку,
 * который открыл раздел, это ничего не давало: где их задавать, в тексте не
 * было. Теперь ошибка ведёт на страницу «Интеграции», где эти переменные и
 * правятся.
 */
export function SmilekitBotApiError({ error }: { error: string }) {
  return (
    <div className="p-4 md:p-8">
      <div
        className="flex max-w-xl items-start gap-3 rounded-2xl p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warn)' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Нет связи с ботом Smilekit
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            {error}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            Раздел работает через внутренний API бота (aiogram, <code>/internal/*</code>). Нужны две
            переменные — <code>SMILEKIT_BOT_API_URL</code> и <code>SMILEKIT_BOT_INTERNAL_TOKEN</code> — и сам
            бот должен быть запущен.
          </p>
          <Link
            href="/dashboard/integrations"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}
          >
            <Plug size={13} /> Открыть «Интеграции»
          </Link>
        </div>
      </div>
    </div>
  )
}
