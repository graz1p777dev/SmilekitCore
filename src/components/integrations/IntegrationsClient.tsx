'use client'

// Страница «Интеграции»: подключение каналов, ключи моделей и переменные —
// всё правится здесь, без деплоя.
//
// Секреты в браузер не приходят: в поле показывается маска, а ввод нового
// значения заменяет старое целиком. Пустое поле сохранением не считается —
// иначе случайный «Сохранить» стирал бы рабочий токен.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Eye, KeyRound, Plug, Plus, Sparkles, Trash2, TriangleAlert, Zap } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  deleteVariable,
  saveVariable,
  testChannel,
  toggleChannel,
  type IntegrationView,
  type PanelData,
} from '@/actions/integrations-panel'

const KIND_TITLES: Record<IntegrationView['kind'], string> = {
  channel: 'Каналы — откуда приходят и куда уходят сообщения',
  ai: 'Модели — кто пишет ответы и расшифровывает голосовые',
  module: 'Модули — что происходит после событий',
}

const KIND_ICONS: Record<IntegrationView['kind'], typeof Plug> = {
  channel: Plug,
  ai: Sparkles,
  module: Zap,
}

export default function IntegrationsClient({ initial }: { initial: PanelData }) {
  const [data, setData] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newVar, setNewVar] = useState({ name: '', value: '', isSecret: true })

  function persist(input: { name: string; value: string; isSecret: boolean; integrationId?: string | null }) {
    if (!input.value.trim()) {
      toast.error('Пустое значение не сохраняем — так теряются рабочие ключи')
      return
    }
    startTransition(async () => {
      const result = await saveVariable(input)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${input.name} сохранена`)
      setDrafts((current) => ({ ...current, [input.name]: '' }))
      setData((current) => markSet(current, input.name, input.isSecret, input.value))
    })
  }

  function drop(name: string) {
    startTransition(async () => {
      const result = await deleteVariable(name)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${name} удалена`)
      setData((current) => ({
        ...current,
        extraVariables: current.extraVariables.filter((item) => item.name !== name),
        integrations: current.integrations.map((integration) => ({
          ...integration,
          variables: integration.variables.map((variable) =>
            variable.name === name ? { ...variable, isSet: false, display: '' } : variable
          ),
        })),
      }))
    })
  }

  function toggle(integration: IntegrationView) {
    const next = !integration.enabled
    startTransition(async () => {
      const result = await toggleChannel(integration.id, next)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(next ? 'Бот отвечает клиентам' : 'Бот замолчал: история и сделки ведутся дальше')
      setData((current) => ({
        ...current,
        integrations: current.integrations.map((item) =>
          item.id === integration.id ? { ...item, enabled: next } : item
        ),
      }))
    })
  }

  function check(integration: IntegrationView) {
    startTransition(async () => {
      const result = await testChannel(integration.id)
      if (result.success) toast.success(result.details)
      else toast.error(result.error)
    })
  }

  const groups: IntegrationView['kind'][] = ['channel', 'ai', 'module']

  return (
    <div className="min-h-full" style={{ background: 'var(--surface-2)' }}>
      <PageHeader
        title="Интеграции"
        subtitle="Каналы, модели и переменные — подключение без правки кода и без деплоя"
      />

      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
        {!data.encryptionReady && (
          <section className="flex items-start gap-3 rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-200">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Секреты сохранять некуда</p>
              <p className="mt-1">
                Задайте переменную <code className="rounded bg-amber-100 px-1">INTEGRATION_ENCRYPTION_KEY</code> в
                Railway — ею шифруются токены. Это единственный ключ, который остаётся в панели хостинга.
              </p>
            </div>
          </section>
        )}

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} style={{ color: 'var(--brand-ink)' }} />
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                Порядок моделей
              </p>
              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                Берётся первая настроенная, умеющая нужное. Сейчас: <code>{data.aiOrder}</code>
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              defaultValue={data.aiOrder}
              onChange={(event) => setDrafts((current) => ({ ...current, AI_PROVIDERS: event.target.value }))}
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                persist({ name: 'AI_PROVIDERS', value: drafts.AI_PROVIDERS ?? data.aiOrder, isSecret: false })
              }
            >
              Сохранить
            </Button>
          </div>
        </section>

        {groups.map((kind) => {
          const items = data.integrations.filter((item) => item.kind === kind)
          if (!items.length) return null
          const Icon = KIND_ICONS[kind]

          return (
            <section key={kind} className="space-y-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink-3)' }}>
                <Icon size={15} /> {KIND_TITLES[kind]}
              </h2>

              {items.map((integration) => (
                <article key={integration.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 md:p-6">
                  <header className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
                          {integration.title}
                        </h3>
                        <StatusBadge configured={integration.configured} missing={integration.missing} />
                        {integration.abilities.map((ability) => (
                          <span
                            key={ability}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600"
                          >
                            {ability}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>
                        {integration.id}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {integration.canTest && (
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => check(integration)}>
                          <Eye size={14} /> Проверить подключение
                        </Button>
                      )}
                      {integration.enabled !== null && (
                        <Button
                          variant={integration.enabled ? 'default' : 'outline'}
                          size="sm"
                          disabled={pending}
                          onClick={() => toggle(integration)}
                        >
                          {integration.enabled ? 'Бот включён' : 'Бот выключен'}
                        </Button>
                      )}
                    </div>
                  </header>

                  {integration.variables.length > 0 && (
                    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                      {integration.variables.map((variable) => (
                        <div key={variable.name} className="grid gap-2 md:grid-cols-[minmax(0,320px)_1fr_auto] md:items-center">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                              {variable.name}
                              {variable.required && <span className="ml-1 text-red-500">*</span>}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                              {variable.description}
                            </p>
                          </div>
                          <Input
                            value={drafts[variable.name] ?? ''}
                            placeholder={variable.isSet ? variable.display || 'значение сохранено' : 'не задано'}
                            type={variable.isSecret ? 'password' : 'text'}
                            autoComplete="off"
                            onChange={(event) =>
                              setDrafts((current) => ({ ...current, [variable.name]: event.target.value }))
                            }
                            className="text-xs"
                          />
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              disabled={pending || !(drafts[variable.name] ?? '').trim()}
                              onClick={() =>
                                persist({
                                  name: variable.name,
                                  value: drafts[variable.name] ?? '',
                                  isSecret: variable.isSecret,
                                  integrationId: integration.id,
                                })
                              }
                            >
                              <Check size={14} />
                            </Button>
                            {variable.isSet && (
                              <Button variant="outline" size="sm" disabled={pending} onClick={() => drop(variable.name)}>
                                <Trash2 size={14} />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </section>
          )
        })}

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 md:p-6">
          <div className="flex items-center gap-2.5">
            <KeyRound size={18} style={{ color: 'var(--brand-ink)' }} />
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                Свои переменные
              </p>
              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                Всё, что нужно интеграциям сверх объявленного. Имя — латиница в верхнем регистре: MY_TOKEN
              </p>
            </div>
          </div>

          {data.extraVariables.length > 0 && (
            <div className="mt-4 space-y-2">
              {data.extraVariables.map((variable) => (
                <div key={variable.name} className="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                      {variable.name}
                    </p>
                    <p className="truncate text-xs" style={{ color: 'var(--ink-3)' }}>
                      {variable.display || '—'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => drop(variable.name)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,260px)_1fr_auto_auto] md:items-end">
            <div>
              <Label className="text-xs">Имя</Label>
              <Input
                value={newVar.name}
                placeholder="MY_TOKEN"
                onChange={(event) => setNewVar((current) => ({ ...current, name: event.target.value.toUpperCase() }))}
                className="mt-1 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Значение</Label>
              <Input
                value={newVar.value}
                type={newVar.isSecret ? 'password' : 'text'}
                autoComplete="off"
                onChange={(event) => setNewVar((current) => ({ ...current, value: event.target.value }))}
                className="mt-1 text-xs"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs" style={{ color: 'var(--ink-3)' }}>
              <input
                type="checkbox"
                checked={newVar.isSecret}
                onChange={(event) => setNewVar((current) => ({ ...current, isSecret: event.target.checked }))}
              />
              секрет
            </label>
            <Button
              disabled={pending || !newVar.name.trim() || !newVar.value.trim()}
              onClick={() => {
                persist({ name: newVar.name, value: newVar.value, isSecret: newVar.isSecret })
                setNewVar({ name: '', value: '', isSecret: true })
              }}
            >
              <Plus size={14} /> Добавить
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}

function markSet(data: PanelData, name: string, isSecret: boolean, value: string): PanelData {
  const display = isSecret ? `••••${value.slice(-4)}` : value
  const known = data.integrations.some((integration) =>
    integration.variables.some((variable) => variable.name === name)
  )
  return {
    ...data,
    aiOrder: name === 'AI_PROVIDERS' ? value : data.aiOrder,
    integrations: data.integrations.map((integration) => ({
      ...integration,
      variables: integration.variables.map((variable) =>
        variable.name === name ? { ...variable, isSet: true, display } : variable
      ),
      missing: integration.missing.filter((item) => item !== name),
      configured: integration.missing.filter((item) => item !== name).length === 0,
    })),
    extraVariables:
      known || data.extraVariables.some((item) => item.name === name)
        ? data.extraVariables.map((item) => (item.name === name ? { ...item, display } : item))
        : [...data.extraVariables, { name, display, isSecret, description: null }],
  }
}

function StatusBadge({ configured, missing }: { configured: boolean; missing: string[] }) {
  if (configured) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        настроено
      </span>
    )
  }
  return (
    <span
      className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600"
      title={missing.join(', ')}
    >
      не хватает: {missing.length}
    </span>
  )
}
