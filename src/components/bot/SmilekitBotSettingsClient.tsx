'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Bot, Cpu, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { saveBotSettings } from '@/actions/smilekit-bot-settings'
import { SmilekitBotEventsTerminal } from '@/components/bot/SmilekitBotEventsTerminal'
import {
  SMILEKIT_BOT_PROMPT_LIMIT,
  type SmilekitBotSettings,
  type SmilekitBotSettingsInput,
} from '@/lib/models/smilekit-bot'

const PROMPT_FIELDS: {
  key: 'managerPrompt' | 'supervisorPrompt'
  label: string
  caption: string
  rows: number
}[] = [
  {
    key: 'managerPrompt',
    label: 'Промпт менеджера',
    caption: 'Инструкция консультанту, который отвечает клиенту в Telegram: тон, воронка, база знаний, правила заказа.',
    rows: 16,
  },
  {
    key: 'supervisorPrompt',
    label: 'Промпт супервизора',
    caption:
      'Внутренняя проверка черновика перед отправкой клиенту — устойчивость к prompt injection, отсутствие выдуманных фактов, формат JSON-результата.',
    rows: 12,
  },
]

function toInput(settings: SmilekitBotSettings): SmilekitBotSettingsInput {
  return {
    managerPrompt: settings.managerPrompt,
    supervisorPrompt: settings.supervisorPrompt,
    model: settings.model,
  }
}

export function SmilekitBotSettingsClient({ settings }: { settings: SmilekitBotSettings }) {
  const [saved, setSaved] = useState<SmilekitBotSettings>(settings)
  const [form, setForm] = useState<SmilekitBotSettingsInput>(() => toInput(settings))
  const [saving, startSaving] = useTransition()

  const set = <K extends keyof SmilekitBotSettingsInput>(key: K, value: SmilekitBotSettingsInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const dirty = (Object.keys(form) as (keyof SmilekitBotSettingsInput)[]).some(
    (key) => form[key] !== saved[key]
  )

  function isDefault(key: 'managerPrompt' | 'supervisorPrompt'): boolean {
    // Пока текст в форме совпадает с последним сохранённым — берём флаг с бота.
    // Если пользователь его правит, статус "по умолчанию" уже неактуален
    // до следующего сохранения, поэтому показываем "изменено, не сохранено".
    if (form[key] !== saved[key]) return false
    return key === 'managerPrompt' ? saved.managerPromptIsDefault : saved.supervisorPromptIsDefault
  }

  function handleSave() {
    startSaving(async () => {
      const result = await saveBotSettings(form)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSaved(result.data)
      setForm(toInput(result.data))
      toast.success('Настройки бота сохранены')
      for (const warning of result.warnings) toast.warning(warning)
    })
  }

  function handleReset() {
    setForm(toInput(saved))
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-8" style={{ maxWidth: 940 }}>
      <div>
        <div className="kicker">Telegram-бот Smilekit</div>
        <h1 className="block-title" style={{ marginTop: 7 }}>
          Настройки бота
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-3)' }}>
          Всё с этой страницы уходит боту напрямую (aiogram, Railway). Изменения применяются к следующему ответу
          клиенту — без передеплоя.
        </p>
      </div>

      <SmilekitBotEventsTerminal />

      <SectionCard icon={<Cpu size={15} color="#fff" />} title="Модель">
        <p className="mb-3 text-xs" style={{ color: 'var(--ink-3)' }}>
          Одна модель на обе задачи бота: черновик ответа менеджера и проверка супервизором. Список моделей задаёт
          сам бот.
        </p>
        <Select value={form.model} onValueChange={(value) => set('model', value ?? form.model)} disabled={saving}>
          <SelectTrigger className="h-9" style={{ maxWidth: 360 }}>
            <SelectValue>{form.model}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {saved.models.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SectionCard>

      {PROMPT_FIELDS.map((field) => (
        <PromptCard
          key={field.key}
          label={field.label}
          caption={field.caption}
          rows={field.rows}
          isDefault={isDefault(field.key)}
          value={form[field.key]}
          onChange={(value) => set(field.key, value)}
          disabled={saving}
        />
      ))}

      <div
        className="sticky bottom-4 flex flex-wrap items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-2xl)',
          boxShadow: '0 12px 32px -14px rgba(28,20,22,0.22)',
        }}
      >
        <Button onClick={handleSave} disabled={saving || !dirty} className="gap-1.5">
          <Save size={14} />
          {saving ? 'Сохранение…' : 'Сохранить настройки'}
        </Button>
        <Button variant="ghost" onClick={handleReset} disabled={saving || !dirty} className="gap-1.5">
          <RotateCcw size={14} />
          Отменить изменения
        </Button>
        <span className="text-xs" style={{ color: dirty ? 'var(--brand-ink)' : 'var(--ink-3)' }}>
          {dirty ? 'Есть несохранённые изменения' : 'Всё сохранено на боте'}
        </span>
      </div>
    </div>
  )
}

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card" style={{ border: '1px solid var(--line)' }}>
      <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--brand-ink)' }}>
          {icon}
        </div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function PromptCard({
  label, caption, rows, isDefault, value, onChange, disabled,
}: {
  label: string
  caption: string
  rows: number
  isDefault: boolean
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const used = value.trim().length
  const left = SMILEKIT_BOT_PROMPT_LIMIT - used
  const tight = left <= SMILEKIT_BOT_PROMPT_LIMIT * 0.05

  return (
    <div className="rounded-2xl bg-card p-5" style={{ border: '1px solid var(--line)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot size={14} style={{ color: 'var(--brand-ink)' }} />
          <Label className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{label}</Label>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={
              isDefault
                ? { background: 'var(--surface-3)', color: 'var(--ink-3)' }
                : { background: 'var(--brand-soft)', color: 'var(--brand-ink)' }
            }
          >
            <ShieldCheck size={10} />
            {isDefault ? 'значение по умолчанию' : 'сохранённое значение'}
          </span>
        </div>
        <span className="text-[11px] tabular-nums" style={{ color: tight ? 'var(--brand-ink)' : 'var(--ink-3)' }}>
          {used.toLocaleString('ru-RU')} / {SMILEKIT_BOT_PROMPT_LIMIT.toLocaleString('ru-RU')} · осталось{' '}
          {left.toLocaleString('ru-RU')}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>{caption}</p>
      <Textarea
        value={value}
        rows={rows}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-3 resize-y font-mono text-xs leading-relaxed"
      />
      <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-3)' }}>
        Текст длиннее {SMILEKIT_BOT_PROMPT_LIMIT.toLocaleString('ru-RU')} символов бот обрежет молча — редактируйте,
        пока справа не «0 осталось».
      </p>
    </div>
  )
}
