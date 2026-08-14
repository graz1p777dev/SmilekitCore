'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Search, Trash2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { updateWhatsappSettings, searchWhatsappGroups } from '@/actions/whatsapp-settings'
import type { WhatsappBotConfig, OutboundWebhook } from '@/lib/greenapi/config'
import type { GreenApiGroup } from '@/lib/greenapi/client'
import {
  DEFAULT_COMPLAINT_PROMPT,
  DEFAULT_COOPERATION_REPLY,
  DEFAULT_DOUBT_RESULT_REPLY,
  DEFAULT_FIRST_USE_EFFECT,
  DEFAULT_LOW_STOCK_CTA,
  DEFAULT_ORDER_CHECKLIST,
  DEFAULT_PRODUCT_INFO,
} from '@/lib/greenapi/default-templates'

// Ярлыки, подсказки и реальный текст по умолчанию для шаблонов — тексты
// синхронизированы вручную с src/lib/greenapi/default-templates.ts (общий
// файл, его же читает bot-reply.ts, чтобы этот список не разошёлся с тем,
// что реально уходит клиенту).
const TEMPLATE_FIELDS: { key: keyof WhatsappBotConfig['templates']; label: string; hint: string; fallback: string }[] = [
  { key: 'productInfo', label: 'Знакомство (первое сообщение)', hint: 'Отправляется новому клиенту или по рекламной ссылке', fallback: DEFAULT_PRODUCT_INFO },
  { key: 'orderChecklist', label: 'Чек-лист оформления заказа', hint: 'Клиент подтвердил заказ — что от него нужно', fallback: DEFAULT_ORDER_CHECKLIST },
  { key: 'doubtResult', label: 'Ответ на сомнения ("не мошенники?")', hint: 'Обязательна фраза-гарантия по ТЗ, если меняете текст', fallback: DEFAULT_DOUBT_RESULT_REPLY },
  { key: 'firstUseEffect', label: 'Эффект с первого применения', hint: 'После подтверждения города/доставки, тоже озвучивается голосом', fallback: DEFAULT_FIRST_USE_EFFECT },
  { key: 'lowStockCta', label: 'CTA «мало на складе»', hint: 'Дожим после эффекта, если скидка ещё не обсуждалась', fallback: DEFAULT_LOW_STOCK_CTA },
  { key: 'complaintPrompt', label: 'Реакция на жалобу', hint: 'Клиент недоволен — уточняющий вопрос', fallback: DEFAULT_COMPLAINT_PROMPT },
  { key: 'cooperationReply', label: 'Ответ на предложение сотрудничества', hint: 'Опт/дилерство — передаём менеджеру', fallback: DEFAULT_COOPERATION_REPLY },
]

export default function WhatsappSettingsClient({ initialConfig }: { initialConfig: WhatsappBotConfig }) {
  const [config, setConfig] = useState(initialConfig)
  const [pending, startTransition] = useTransition()
  const [groupQuery, setGroupQuery] = useState('')
  const [groups, setGroups] = useState<GreenApiGroup[]>([])
  const [searching, setSearching] = useState(false)
  const [webhookName, setWebhookName] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')

  function save(patch: Partial<WhatsappBotConfig>, successMessage: string) {
    const next = { ...config, ...patch }
    setConfig(next)
    startTransition(async () => {
      const result = await updateWhatsappSettings(patch)
      if (!result.success) {
        toast.error(result.error)
        setConfig(config) // откат
        return
      }
      toast.success(successMessage)
    })
  }

  function searchGroups() {
    setSearching(true)
    startTransition(async () => {
      const result = await searchWhatsappGroups(groupQuery)
      setSearching(false)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setGroups(result.groups)
    })
  }

  function addWebhook() {
    if (!webhookName.trim() || !webhookUrl.trim()) return
    const hook: OutboundWebhook = { id: crypto.randomUUID(), name: webhookName.trim(), url: webhookUrl.trim() }
    save({ outboundWebhooks: [...config.outboundWebhooks, hook] }, 'Вебхук добавлен')
    setWebhookName('')
    setWebhookUrl('')
  }

  function removeWebhook(id: string) {
    save({ outboundWebhooks: config.outboundWebhooks.filter((h) => h.id !== id) }, 'Вебхук удалён')
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--surface-2)' }}>
      <PageHeader
        title="WhatsApp: шаблоны и доставка"
        subtitle="Тексты бота, группа доставки и внешние интеграции — без деплоя"
      />
      <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
        {/* Шаблоны */}
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 md:p-7">
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Шаблоны сообщений</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            Текущий текст, который реально уходит клиенту, — редактируйте прямо здесь.
          </p>
          <div className="mt-5 space-y-5">
            {TEMPLATE_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label>{field.label}</Label>
                <p className="text-xs" style={{ color: 'var(--ink-3)' }}>{field.hint}</p>
                <Textarea
                  value={config.templates[field.key] ?? field.fallback}
                  onChange={(event) =>
                    setConfig((prev) => ({ ...prev, templates: { ...prev.templates, [field.key]: event.target.value } }))
                  }
                  onBlur={(event) =>
                    save({ templates: { ...config.templates, [field.key]: event.target.value } }, 'Шаблон сохранён')
                  }
                  className="min-h-20 resize-y text-sm leading-relaxed"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Группа доставки */}
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 md:p-7">
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Группа доставки WhatsApp</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            Подтверждённый (и требующий проверки) заказ уходит сюда, вместе с чеком.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Input
              value={groupQuery}
              onChange={(event) => setGroupQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && searchGroups()}
              placeholder="Найти группу по названию…"
            />
            <Button variant="outline" onClick={searchGroups} disabled={searching}>
              <Search size={15} /> {searching ? '…' : 'Найти'}
            </Button>
          </div>
          {groups.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => save({ deliveryGroupId: g.id }, `Группа «${g.name}» выбрана`)}
                  className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-[#f1ebfa]"
                  style={{
                    background: config.deliveryGroupId === g.id ? '#f1ebfa' : 'var(--surface-2)',
                    color: 'var(--ink-2)',
                  }}
                >
                  <span className="truncate">{g.name}</span>
                  {config.deliveryGroupId === g.id && (
                    <span className="shrink-0 text-xs font-semibold" style={{ color: '#5115a4' }}>выбрана</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {config.deliveryGroupId && groups.length === 0 && (
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              Текущая группа: <code className="rounded bg-gray-100 px-1.5 py-0.5">{config.deliveryGroupId}</code>
            </p>
          )}
          <div className="mt-4 space-y-1.5">
            <Label>Формат сообщения в группу</Label>
            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
              Доступны подстановки: {'{name}'}, {'{phone}'}, {'{address}'}
            </p>
            <Textarea
              value={config.deliveryPrompt ?? ''}
              onChange={(event) => setConfig((prev) => ({ ...prev, deliveryPrompt: event.target.value }))}
              onBlur={(event) => save({ deliveryPrompt: event.target.value }, 'Формат сохранён')}
              placeholder="Новый заказ ({name}, {phone})&#10;Адрес: {address}"
              className="min-h-20 resize-y text-sm leading-relaxed"
            />
          </div>
        </section>

        {/* Товароучёт */}
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 md:p-7">
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Товароучёт</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            Остаток коробок. Списывается автоматически на каждый подтверждённый чек (1 шт. за заказ).
            Пусто — товароучёт выключен, ничего не считается.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={config.stock.quantity ?? ''}
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, stock: { quantity: event.target.value === '' ? null : Number(event.target.value) } }))
              }
              onBlur={(event) =>
                save({ stock: { quantity: event.target.value === '' ? null : Number(event.target.value) } }, 'Остаток сохранён')
              }
              placeholder="Не считается"
              className="max-w-32"
            />
            <span className="text-sm" style={{ color: 'var(--ink-3)' }}>коробок в наличии</span>
          </div>
        </section>

        {/* Внешние CRM */}
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 md:p-7">
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Внешние CRM (Bitrix и другие)</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            На каждый подтверждённый заказ WhatsApp CRM отправит JSON-вебхук на указанные адреса —
            подключите Bitrix24, Zapier, Make или свой обработчик.
          </p>
          <div className="mt-4 space-y-2">
            {config.outboundWebhooks.map((hook) => (
              <div key={hook.id} className="flex items-center gap-2 rounded-xl px-3.5 py-2.5" style={{ background: 'var(--surface-2)' }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--ink-2)' }}>{hook.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--ink-3)' }}>{hook.url}</p>
                </div>
                <button onClick={() => removeWebhook(hook.id)} className="shrink-0 text-gray-400 hover:text-red-500">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} placeholder="Название (например Bitrix24)" />
            <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://…" />
            <Button onClick={addWebhook} disabled={pending}>
              <Plus size={15} /> Добавить
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
