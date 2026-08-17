'use client'

// Конструктор сценариев: канва с узлами, как в n8n, но под наши сущности.
//
// Модель намеренно простая: слева направо идут ветки, сверху вниз — шаги.
// Одна ветка = «если условия совпали → выполнить действия по порядку».
// Ветки проверяются сверху вниз, выигрывает первая совпавшая — это и есть
// if / else if, только без вложенности, которую менеджеру не собрать.
//
// Канва — это отображение, а не источник истины: выполняется то, что лежит
// в conditions/actions, а координаты узлов влияют лишь на внешний вид.

import { useCallback, useMemo, useState, useTransition, type CSSProperties } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import { Bell, Bot, Clock, Copy, FileText, GitBranch, Image, MessageSquare, Plus, Save, Send, Shuffle, Trash2, Variable, Webhook, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  deleteFlowRule,
  deleteFlowTemplate,
  deleteFlowVariable,
  matchFlowRules,
  saveFlowRule,
  saveFlowTemplate,
  saveFlowVariable,
} from '@/actions/flows'
import type { FlowAction, FlowActionType, FlowCondition, FlowRule, FlowTemplate, FlowVariable } from '@/core'

// ─── Словарь для интерфейса ──────────────────────────────────────────────

const FIELD_LABELS: Record<FlowCondition['field'], string> = {
  text: 'Сообщение клиента',
  last_bot_text: 'Последний ответ бота',
  history: 'Вся переписка',
  author_name: 'Имя клиента',
}

const OP_LABELS: Record<FlowCondition['op'], string> = {
  contains: 'содержит',
  not_contains: 'не содержит',
  equals: 'равно',
  matches: 'подходит под regex',
  is_first_message: 'первое сообщение в чате',
}

const ACTION_LABELS: Record<FlowActionType, string> = {
  reply: 'Ответить текстом',
  template: 'Отправить шаблон',
  media: 'Отправить файл',
  wait: 'Подождать',
  ai_reply: 'Ответ модели',
  stage: 'Двинуть этап сделки',
  notify: 'Уведомить менеджеров',
  webhook: 'Дёрнуть вебхук',
}

const ACTION_ICONS: Record<FlowActionType, typeof MessageSquare> = {
  reply: MessageSquare,
  template: FileText,
  media: Image,
  wait: Clock,
  ai_reply: Bot,
  stage: Zap,
  notify: Bell,
  webhook: Webhook,
}

const STAGE_ACTIONS = [
  ['need_identified', 'Потребность выявлена'],
  ['interest_confirmed', 'Интерес подтверждён'],
  ['ready_to_buy', 'Готов к покупке'],
  ['order', 'Передан менеджеру'],
  ['non_standard_request', 'Нестандартный запрос'],
]

function emptyAction(type: FlowActionType): FlowAction {
  switch (type) {
    case 'reply':
      return { type: 'reply', text: '' }
    case 'template':
      return { type: 'template', templateId: '' }
    case 'media':
      return { type: 'media', url: '', fileName: 'file.jpg' }
    case 'wait':
      return { type: 'wait', minutes: 5, cancelIfReplied: true }
    case 'ai_reply':
      return { type: 'ai_reply' }
    case 'stage':
      return { type: 'stage', action: 'need_identified' }
    case 'notify':
      return { type: 'notify', title: '' }
    case 'webhook':
      return { type: 'webhook', url: '' }
  }
}

function actionSummary(action: FlowAction, templateNames: Map<string, string>): string {
  switch (action.type) {
    case 'reply':
      return action.text || 'текст не задан'
    case 'template':
      return templateNames.get(action.templateId) ?? 'шаблон не выбран'
    case 'media':
      return action.fileName || action.url || 'файл не задан'
    case 'wait':
      return `${action.minutes} мин${action.cancelIfReplied === false ? '' : ', отменить если клиент ответит'}`
    case 'ai_reply':
      return action.instruction || 'обычный промпт бота'
    case 'stage':
      return STAGE_ACTIONS.find(([key]) => key === action.action)?.[1] ?? action.action
    case 'notify':
      return action.title || 'заголовок не задан'
    case 'webhook':
      return action.url || 'адрес не задан'
  }
}

function conditionSummary(condition: FlowCondition): string {
  if (condition.op === 'is_first_message') return 'первое сообщение в чате'
  return `${FIELD_LABELS[condition.field]} ${OP_LABELS[condition.op]} «${condition.value}»`
}

// ─── Узлы канвы ──────────────────────────────────────────────────────────

type NodeData = {
  label: string
  sub: string
  tone: 'trigger' | 'condition' | 'action'
  disabled?: boolean
  icon?: typeof MessageSquare
}

const TONE_STYLES: Record<NodeData['tone'], CSSProperties> = {
  trigger: {
    background: 'linear-gradient(135deg, rgba(124,58,237,0.28), rgba(91,33,182,0.18))',
    borderColor: 'rgba(167,139,250,0.55)',
    boxShadow: '0 8px 28px -10px rgba(124,58,237,0.55)',
  },
  condition: {
    background: 'rgba(251,191,36,0.10)',
    borderColor: 'rgba(251,191,36,0.38)',
  },
  action: {
    background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
    borderColor: 'var(--line)',
  },
}

function FlowNode({ data, selected }: NodeProps) {
  const item = data as NodeData
  const Icon = item.icon ?? GitBranch
  return (
    <div
      className={`w-56 rounded-2xl border px-3 py-2.5 backdrop-blur-md transition ${
        selected ? 'ring-2 ring-[var(--brand)]' : ''
      } ${item.disabled ? 'opacity-45' : ''}`}
      style={TONE_STYLES[item.tone]}
    >
      <Handle type="target" position={Position.Top} className="!bg-[var(--ink-4)]" />
      <div className="flex items-center gap-2">
        <Icon size={14} className="shrink-0" style={{ color: 'var(--brand-ink)' }} />
        <p className="truncate text-xs font-bold" style={{ color: 'var(--ink)' }}>{item.label}</p>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug" style={{ color: 'var(--ink-3)' }}>{item.sub}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--ink-4)]" />
    </div>
  )
}

const nodeTypes = { flow: FlowNode }

const VIEWS: [View, string, typeof MessageSquare][] = [
  ['canvas', 'Канва', Shuffle],
  ['templates', 'Шаблоны', FileText],
  ['variables', 'Переменные', Variable],
]

const COLUMN_WIDTH = 260
const ROW_HEIGHT = 110

// ─── Страница ────────────────────────────────────────────────────────────

type View = 'canvas' | 'templates' | 'variables'

export default function FlowCanvas({
  initial,
  initialTemplates,
  initialVariables,
}: {
  initial: FlowRule[]
  initialTemplates: FlowTemplate[]
  initialVariables: FlowVariable[]
}) {
  const [rules, setRules] = useState<FlowRule[]>(initial)
  const [templates, setTemplates] = useState<FlowTemplate[]>(initialTemplates)
  const [variables, setVariables] = useState<FlowVariable[]>(initialVariables)
  const [view, setView] = useState<View>('canvas')
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [probe, setProbe] = useState('')

  // Узлы канвы показывают название шаблона, а не его id.
  const templateNames = useMemo(
    () => new Map(templates.map((item) => [item.id, item.name])),
    [templates]
  )

  const markDirty = useCallback((id: string) => {
    setDirty((current) => new Set(current).add(id))
  }, [])

  const updateRule = useCallback(
    (id: string, patch: Partial<FlowRule>) => {
      setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
      markDirty(id)
    },
    [markDirty]
  )

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      {
        id: 'trigger',
        type: 'flow',
        position: { x: 0, y: 0 },
        data: {
          label: 'Входящее сообщение',
          sub: 'Клиент написал в WhatsApp',
          tone: 'trigger',
          icon: Send,
        } satisfies NodeData,
        draggable: false,
      },
    ]
    const edges: Edge[] = []

    rules.forEach((rule, column) => {
      const x = column * COLUMN_WIDTH
      const conditionId = `rule:${rule.id}`
      nodes.push({
        id: conditionId,
        type: 'flow',
        position: rule.layout?.[conditionId] ?? { x, y: ROW_HEIGHT },
        data: {
          label: rule.name || 'Без названия',
          sub: rule.conditions.length ? rule.conditions.map(conditionSummary).join(' И ') : 'условия не заданы',
          tone: 'condition',
          disabled: !rule.enabled,
          icon: GitBranch,
        } satisfies NodeData,
      })
      edges.push({ id: `e:trigger:${rule.id}`, source: 'trigger', target: conditionId, animated: rule.enabled })

      rule.actions.forEach((action, index) => {
        const id = `action:${rule.id}:${index}`
        nodes.push({
          id,
          type: 'flow',
          position: rule.layout?.[id] ?? { x, y: ROW_HEIGHT * (index + 2) },
          data: {
            label: ACTION_LABELS[action.type],
            sub: actionSummary(action, templateNames),
            tone: 'action',
            disabled: !rule.enabled,
            icon: ACTION_ICONS[action.type],
          } satisfies NodeData,
        })
        edges.push({
          id: `e:${rule.id}:${index}`,
          source: index === 0 ? conditionId : `action:${rule.id}:${index - 1}`,
          target: id,
        })
      })
    })

    return { nodes, edges }
  }, [rules, templateNames])

  function addRule() {
    startTransition(async () => {
      const draft: FlowRule = {
        id: '',
        channel: 'greenapi',
        name: `Ветка ${rules.length + 1}`,
        enabled: false,
        position: rules.length,
        conditions: [{ field: 'text', op: 'contains', value: '' }],
        actions: [{ type: 'reply', text: '' }],
        stopAfter: true,
        dedupe: { mode: 'off' },
        layout: {},
      }
      const result = await saveFlowRule(draft)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setRules((current) => [...current, { ...draft, id: result.id as string }])
      setSelected(`rule:${result.id}`)
      toast.success('Ветка создана — выключена, пока не настроите')
    })
  }

  function saveAll() {
    startTransition(async () => {
      for (const rule of rules.filter((item) => dirty.has(item.id))) {
        const result = await saveFlowRule(rule)
        if (!result.success) {
          toast.error(`${rule.name}: ${result.error}`)
          return
        }
      }
      setDirty(new Set())
      toast.success('Сценарий сохранён')
    })
  }

  function removeRule(id: string) {
    startTransition(async () => {
      const result = await deleteFlowRule(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setRules((current) => current.filter((rule) => rule.id !== id))
      setSelected(null)
      toast.success('Ветка удалена')
    })
  }

  function runProbe() {
    startTransition(async () => {
      const outcome = await matchFlowRules(probe)
      if (!outcome.success) {
        toast.error(outcome.error)
        return
      }
      // Совпадения нет — это не ошибка, но и не успех: показываем нейтрально,
      // чтобы «ничего не сработало» не выглядело как «всё хорошо».
      if (outcome.result.ruleId) toast.success(outcome.result.explanation)
      else toast.info(outcome.result.explanation)
    })
  }

  const selectedRule = selected?.startsWith('rule:')
    ? rules.find((rule) => `rule:${rule.id}` === selected)
    : selected?.startsWith('action:')
      ? rules.find((rule) => rule.id === selected.split(':')[1])
      : null
  const selectedActionIndex = selected?.startsWith('action:') ? Number(selected.split(':')[2]) : null

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'transparent' }}>
      <PageHeader
        title="Сценарии"
        subtitle="Если клиент написал — ответить, подождать, сделать. Собирается мышкой, применяется сразу"
        action={
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-0.5 rounded-xl p-0.5"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            >
              {VIEWS.map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-medium transition-colors"
                  style={
                    view === id
                      ? { background: 'var(--brand)', color: 'var(--on-brand)' }
                      : { color: 'var(--ink-3)' }
                  }
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            {view === 'canvas' && (
              <>
                <Button variant="outline" size="sm" onClick={addRule} disabled={pending}>
                  <Plus size={14} /> Новая ветка
                </Button>
                <Button size="sm" onClick={saveAll} disabled={pending || dirty.size === 0}>
                  <Save size={14} /> Сохранить{dirty.size ? ` (${dirty.size})` : ''}
                </Button>
              </>
            )}
          </div>
        }
      />

      {view === 'templates' && (
        <TemplatesManager templates={templates} onChange={setTemplates} pending={pending} run={startTransition} />
      )}

      {view === 'variables' && (
        <VariablesManager variables={variables} onChange={setVariables} pending={pending} run={startTransition} />
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col lg:flex-row', view !== 'canvas' && 'hidden')}>
        <div className="h-[420px] min-w-0 flex-1 lg:h-auto" style={{ background: 'color-mix(in srgb, var(--paper) 55%, transparent)' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelected(node.id === 'trigger' ? null : node.id)}
            onNodeDragStop={(_, node) => {
              const ruleId = node.id.split(':')[1]
              const rule = rules.find((item) => item.id === ruleId)
              if (!rule) return
              updateRule(ruleId, { layout: { ...rule.layout, [node.id]: node.position } })
            }}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} color="rgba(167,139,250,0.14)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside
          className="w-full shrink-0 overflow-y-auto p-5 lg:w-[420px]"
          style={{
            borderLeft: '1px solid var(--line)',
            background: 'color-mix(in srgb, var(--surface) 82%, transparent)',
            backdropFilter: 'blur(16px)',
          }}
        >
          {!selectedRule && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  Как это работает
                </p>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                  Ветки проверяются слева направо: выигрывает первая, у которой совпали все условия. Её действия
                  выполняются сверху вниз. «Подождать» ставит паузу — остаток ветки доиграет планировщик, а если
                  клиент за это время ответит сам, отложенные шаги отменятся.
                </p>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                  Если ни одна ветка не совпала, отвечает встроенный скрипт продаж — как раньше.
                </p>
              </div>

              <div className="rounded-2xl p-4" style={{ background: 'var(--surface-2)' }}>
                <Label className="text-xs">Примерить текст клиента</Label>
                <Input
                  value={probe}
                  onChange={(event) => setProbe(event.target.value)}
                  placeholder="сколько стоит?"
                  className="mt-1 text-xs"
                />
                <Button variant="outline" size="sm" className="mt-2" onClick={runProbe} disabled={pending || !probe.trim()}>
                  Проверить
                </Button>
              </div>

              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                Выберите узел на канве, чтобы настроить его.
              </p>
            </div>
          )}

          {selectedRule && selectedActionIndex === null && (
            <RuleEditor
              rule={selectedRule}
              onChange={(patch) => updateRule(selectedRule.id, patch)}
              onDelete={() => removeRule(selectedRule.id)}
              pending={pending}
            />
          )}

          {selectedRule && selectedActionIndex !== null && (
            <ActionEditor
              rule={selectedRule}
              index={selectedActionIndex}
              templates={templates}
              variables={variables}
              onChange={(actions) => updateRule(selectedRule.id, { actions })}
              onSelect={setSelected}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

// ─── Редакторы ───────────────────────────────────────────────────────────

const selectClass =
  'mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--brand)]'

function RuleEditor({
  rule,
  onChange,
  onDelete,
  pending,
}: {
  rule: FlowRule
  onChange: (patch: Partial<FlowRule>) => void
  onDelete: () => void
  pending: boolean
}) {
  function updateCondition(index: number, patch: Partial<FlowCondition>) {
    onChange({
      conditions: rule.conditions.map((condition, position) =>
        position === index ? { ...condition, ...patch } : condition
      ),
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs">Название ветки</Label>
        <Input value={rule.name} onChange={(event) => onChange({ name: event.target.value })} className="mt-1 text-xs" />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-3)' }}>
          <input type="checkbox" checked={rule.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
          включена
        </label>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-3)' }}>
          <input
            type="checkbox"
            checked={rule.stopAfter}
            onChange={(event) => onChange({ stopAfter: event.target.checked })}
          />
          не продолжать скрипт продаж
        </label>
      </div>

      {/* Защита от дублей */}
      <div>
        <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--ink)' }}>
          <Copy size={13} /> Защита от дублей
        </p>
        <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-3)' }}>
          Сколько раз ветка вправе сработать в одном чате. Клиент, написавший «сколько стоит» трижды,
          не получит три одинаковых ответа.
        </p>
        <select
          value={rule.dedupe?.mode ?? 'off'}
          onChange={(event) =>
            onChange({
              dedupe: {
                mode: event.target.value as FlowRule['dedupe']['mode'],
                minutes: rule.dedupe?.minutes ?? 60,
              },
            })
          }
          className={selectClass}
        >
          <option value="off">Без ограничений</option>
          <option value="once_per_chat">Один раз на чат</option>
          <option value="cooldown">Не чаще, чем раз в…</option>
        </select>
        {rule.dedupe?.mode === 'cooldown' && (
          <div className="mt-2">
            <Label className="text-xs">Пауза между срабатываниями, минут</Label>
            <Input
              type="number"
              min={1}
              value={rule.dedupe.minutes ?? 60}
              onChange={(event) =>
                onChange({ dedupe: { mode: 'cooldown', minutes: Number(event.target.value) } })
              }
              className="mt-1 text-xs"
            />
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
          Условия — должны совпасть все
        </p>
        <div className="mt-2 space-y-3">
          {rule.conditions.map((condition, index) => (
            <div key={index} className="rounded-2xl p-3" style={{ background: 'var(--surface-2)' }}>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={condition.field}
                  onChange={(event) => updateCondition(index, { field: event.target.value as FlowCondition['field'] })}
                  className={selectClass}
                >
                  {Object.entries(FIELD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={condition.op}
                  onChange={(event) => updateCondition(index, { op: event.target.value as FlowCondition['op'] })}
                  className={selectClass}
                >
                  {Object.entries(OP_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {condition.op !== 'is_first_message' && (
                <Input
                  value={condition.value}
                  placeholder="сколько стоит"
                  onChange={(event) => updateCondition(index, { value: event.target.value })}
                  className="mt-2 text-xs"
                />
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => onChange({ conditions: rule.conditions.filter((_, position) => position !== index) })}
              >
                <Trash2 size={13} /> Убрать условие
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => onChange({ conditions: [...rule.conditions, { field: 'text', op: 'contains', value: '' }] })}
        >
          <Plus size={13} /> Условие
        </Button>
      </div>

      <div>
        <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
          Добавить действие
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(ACTION_LABELS) as FlowActionType[]).map((type) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              onClick={() => onChange({ actions: [...rule.actions, emptyAction(type)] })}
            >
              <Plus size={13} /> {ACTION_LABELS[type]}
            </Button>
          ))}
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={onDelete} disabled={pending}>
        <Trash2 size={13} /> Удалить ветку
      </Button>
    </div>
  )
}

function ActionEditor({
  rule,
  index,
  templates,
  variables,
  onChange,
  onSelect,
}: {
  rule: FlowRule
  index: number
  templates: FlowTemplate[]
  variables: FlowVariable[]
  onChange: (actions: FlowAction[]) => void
  onSelect: (id: string | null) => void
}) {
  const action = rule.actions[index]
  if (!action) return null

  function patch(next: Partial<FlowAction>) {
    onChange(
      rule.actions.map((item, position) => (position === index ? ({ ...item, ...next } as FlowAction) : item))
    )
  }

  function move(direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rule.actions.length) return
    const next = [...rule.actions]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    onSelect(`action:${rule.id}:${target}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
          {ACTION_LABELS[action.type]}
        </p>
        <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
          Шаг {index + 1} из {rule.actions.length} в ветке «{rule.name}»
        </p>
      </div>

      {action.type === 'reply' && (
        <div>
          <Label className="text-xs">Текст</Label>
          <Textarea
            value={action.text}
            onChange={(event) => patch({ text: event.target.value })}
            className="mt-1 min-h-28 text-xs"
          />
          <VariableHint variables={variables} />
        </div>
      )}

      {action.type === 'template' && (
        <div>
          <Label className="text-xs">Шаблон</Label>
          <select
            value={action.templateId}
            onChange={(event) => patch({ templateId: event.target.value })}
            className={selectClass}
          >
            <option value="">— выберите шаблон —</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--warn)' }}>
              Шаблонов пока нет — создайте их во вкладке «Шаблоны».
            </p>
          )}
          {action.templateId && (
            <p
              className="mt-2 whitespace-pre-wrap rounded-xl p-2.5 text-[11px] leading-snug"
              style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
            >
              {templates.find((item) => item.id === action.templateId)?.text ?? 'Шаблон удалён'}
            </p>
          )}
        </div>
      )}

      {action.type === 'media' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Ссылка на файл</Label>
            <Input value={action.url} onChange={(event) => patch({ url: event.target.value })} className="mt-1 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Имя файла (с расширением)</Label>
            <Input
              value={action.fileName}
              onChange={(event) => patch({ fileName: event.target.value })}
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Подпись</Label>
            <Input
              value={action.caption ?? ''}
              onChange={(event) => patch({ caption: event.target.value })}
              className="mt-1 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-3)' }}>
            <input type="checkbox" checked={Boolean(action.voice)} onChange={(event) => patch({ voice: event.target.checked })} />
            голосовое сообщение (только .ogg/Opus)
          </label>
        </div>
      )}

      {action.type === 'wait' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Пауза, минут</Label>
            <Input
              type="number"
              min={1}
              max={1440}
              value={action.minutes}
              onChange={(event) => patch({ minutes: Number(event.target.value) })}
              className="mt-1 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-3)' }}>
            <input
              type="checkbox"
              checked={action.cancelIfReplied !== false}
              onChange={(event) => patch({ cancelIfReplied: event.target.checked })}
            />
            отменить, если клиент ответит сам
          </label>
          <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
            Остальные шаги ветки выполнятся после паузы. Планировщик проверяет очередь раз в 30 секунд.
          </p>
        </div>
      )}

      {action.type === 'ai_reply' && (
        <div>
          <Label className="text-xs">Указание модели (необязательно)</Label>
          <Textarea
            value={action.instruction ?? ''}
            placeholder="Ответь коротко, предложи оформить заказ"
            onChange={(event) => patch({ instruction: event.target.value })}
            className="mt-1 min-h-24 text-xs"
          />
        </div>
      )}

      {action.type === 'stage' && (
        <div>
          <Label className="text-xs">Этап</Label>
          <select value={action.action} onChange={(event) => patch({ action: event.target.value })} className={selectClass}>
            {STAGE_ACTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {action.type === 'notify' && (
        <div>
          <Label className="text-xs">Заголовок уведомления</Label>
          <Input value={action.title} onChange={(event) => patch({ title: event.target.value })} className="mt-1 text-xs" />
        </div>
      )}

      {action.type === 'webhook' && (
        <div>
          <Label className="text-xs">Адрес (https)</Label>
          <Input value={action.url} onChange={(event) => patch({ url: event.target.value })} className="mt-1 text-xs" />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            Уйдёт POST с номером, текстом и каналом. Внутренние адреса запрещены.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
        <Button variant="outline" size="sm" onClick={() => move(-1)} disabled={index === 0}>
          Выше
        </Button>
        <Button variant="outline" size="sm" onClick={() => move(1)} disabled={index === rule.actions.length - 1}>
          Ниже
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onChange(rule.actions.filter((_, position) => position !== index))
            onSelect(`rule:${rule.id}`)
          }}
        >
          <Trash2 size={13} /> Удалить шаг
        </Button>
        <Button variant="outline" size="sm" onClick={() => onSelect(`rule:${rule.id}`)}>
          К ветке
        </Button>
      </div>
    </div>
  )
}

// ─── Шаблоны и переменные ───────────────────────────────────────────────────

const VARIABLE_SOURCES: [FlowVariable['source'], string, string][] = [
  ['static', 'Фиксированный текст', 'всегда одно и то же значение'],
  ['date', 'Дата', 'сегодняшняя дата: 17 августа'],
  ['time', 'Время', 'текущее время: 14:30'],
  ['datetime', 'Дата и время', '17 августа, 14:30'],
  ['client_name', 'Имя клиента', 'как он подписан в WhatsApp'],
  ['client_phone', 'Телефон клиента', 'номер, с которого пишет'],
  ['message', 'Сообщение клиента', 'текст, на который отвечаем'],
  ['ai', 'ИИ по промпту', 'модель заполняет значение сама'],
]

/** Подсказка со списком доступных подстановок — чтобы не держать их в голове. */
function VariableHint({ variables }: { variables: FlowVariable[] }) {
  return (
    <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
      Подстановки: <code>{'{{name}}'}</code> — имя клиента, <code>{'{{phone}}'}</code> — номер,{' '}
      <code>{'{{text}}'}</code> — что он написал
      {variables.length > 0 && (
        <>
          {'. Свои: '}
          {variables.map((variable, index) => (
            <span key={variable.id}>
              {index > 0 && ', '}
              <code style={{ color: 'var(--brand-ink)' }}>{`{{${variable.name}}}`}</code>
            </span>
          ))}
        </>
      )}
    </p>
  )
}

function TemplatesManager({
  templates,
  onChange,
  pending,
  run,
}: {
  templates: FlowTemplate[]
  onChange: (next: FlowTemplate[]) => void
  pending: boolean
  run: (fn: () => void) => void
}) {
  const [draft, setDraft] = useState({ name: '', text: '' })

  function save(input: { id?: string; name: string; text: string }) {
    run(async () => {
      const result = await saveFlowTemplate(input)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Шаблон сохранён')
      const id = result.id as string
      onChange(
        input.id
          ? templates.map((item) => (item.id === input.id ? { ...item, ...input } : item))
          : [...templates, { id, name: input.name, text: input.text }]
      )
      if (!input.id) setDraft({ name: '', text: '' })
    })
  }

  function drop(id: string) {
    run(async () => {
      const result = await deleteFlowTemplate(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Шаблон удалён')
      onChange(templates.filter((item) => item.id !== id))
    })
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto p-4 md:p-8">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Готовые тексты, на которые ссылаются ветки. Поправили формулировку здесь — она поменялась везде,
        где шаблон подставлен.
      </p>

      {templates.map((template) => (
        <TemplateRow key={template.id} template={template} onSave={save} onDelete={drop} pending={pending} />
      ))}

      <section
        className="rounded-3xl p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
          Новый шаблон
        </p>
        <div className="mt-3 space-y-2">
          <Input
            value={draft.name}
            placeholder="Название: «Приветствие», «Условия доставки»"
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            className="text-xs"
          />
          <Textarea
            value={draft.text}
            placeholder="Текст, который получит клиент. Можно с подстановками: Здравствуйте, {{name}}!"
            onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
            className="min-h-24 text-xs"
          />
          <Button
            size="sm"
            disabled={pending || !draft.name.trim() || !draft.text.trim()}
            onClick={() => save({ name: draft.name, text: draft.text })}
          >
            <Plus size={14} /> Добавить шаблон
          </Button>
        </div>
      </section>
    </main>
  )
}

function TemplateRow({
  template,
  onSave,
  onDelete,
  pending,
}: {
  template: FlowTemplate
  onSave: (input: { id: string; name: string; text: string }) => void
  onDelete: (id: string) => void
  pending: boolean
}) {
  const [name, setName] = useState(template.name)
  const [text, setText] = useState(template.text)
  const changed = name !== template.name || text !== template.text

  return (
    <section
      className="rounded-3xl p-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} className="text-xs font-semibold" />
        <Button variant="outline" size="sm" disabled={pending} onClick={() => onDelete(template.id)}>
          <Trash2 size={13} />
        </Button>
      </div>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="mt-2 min-h-20 text-xs"
      />
      {changed && (
        <Button
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => onSave({ id: template.id, name, text })}
        >
          <Save size={13} /> Сохранить
        </Button>
      )}
    </section>
  )
}

function VariablesManager({
  variables,
  onChange,
  pending,
  run,
}: {
  variables: FlowVariable[]
  onChange: (next: FlowVariable[]) => void
  pending: boolean
  run: (fn: () => void) => void
}) {
  const [draft, setDraft] = useState<{
    name: string
    source: FlowVariable['source']
    value: string
    aiPrompt: string
  }>({ name: '', source: 'static', value: '', aiPrompt: '' })

  function add() {
    run(async () => {
      const result = await saveFlowVariable({
        name: draft.name,
        source: draft.source,
        value: draft.source === 'static' ? draft.value : null,
        aiPrompt: draft.source === 'ai' ? draft.aiPrompt : null,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Переменная {{${draft.name}}} создана`)
      onChange([
        ...variables,
        {
          id: result.id as string,
          name: draft.name,
          source: draft.source,
          value: draft.source === 'static' ? draft.value : null,
          aiPrompt: draft.source === 'ai' ? draft.aiPrompt : null,
        },
      ])
      setDraft({ name: '', source: 'static', value: '', aiPrompt: '' })
    })
  }

  function drop(id: string) {
    run(async () => {
      const result = await deleteFlowVariable(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Переменная удалена')
      onChange(variables.filter((item) => item.id !== id))
    })
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto p-4 md:p-8">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Подстановки для текстов и шаблонов. Пишете в тексте <code>{'{{имя}}'}</code> — бот подставляет значение
        в момент отправки. ИИ-переменную модель заполняет сама по вашему промпту.
      </p>

      {variables.map((variable) => {
        const meta = VARIABLE_SOURCES.find(([id]) => id === variable.source)
        return (
          <section
            key={variable.id}
            className="flex items-start justify-between gap-3 rounded-2xl p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <div className="min-w-0">
              <code className="text-[13px] font-bold" style={{ color: 'var(--brand-ink)' }}>
                {`{{${variable.name}}}`}
              </code>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                {meta?.[1] ?? variable.source}
                {variable.source === 'static' && variable.value ? ` · «${variable.value}»` : ''}
              </p>
              {variable.source === 'ai' && variable.aiPrompt && (
                <p className="mt-1 text-[11px] italic" style={{ color: 'var(--ink-3)' }}>
                  {variable.aiPrompt}
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => drop(variable.id)}>
              <Trash2 size={13} />
            </Button>
          </section>
        )
      })}

      <section
        className="rounded-3xl p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
          Новая переменная
        </p>
        <div className="mt-3 space-y-2">
          <div>
            <Label className="text-xs">Имя (без фигурных скобок)</Label>
            <Input
              value={draft.name}
              placeholder="город"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Что хранит</Label>
            <select
              value={draft.source}
              onChange={(event) =>
                setDraft((current) => ({ ...current, source: event.target.value as FlowVariable['source'] }))
              }
              className={selectClass}
            >
              {VARIABLE_SOURCES.map(([id, label, hint]) => (
                <option key={id} value={id}>
                  {label} — {hint}
                </option>
              ))}
            </select>
          </div>
          {draft.source === 'static' && (
            <div>
              <Label className="text-xs">Значение</Label>
              <Input
                value={draft.value}
                onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                className="mt-1 text-xs"
              />
            </div>
          )}
          {draft.source === 'ai' && (
            <div>
              <Label className="text-xs">Промпт для модели</Label>
              <Textarea
                value={draft.aiPrompt}
                placeholder="Определи город клиента по переписке. Если города нет — верни пустую строку."
                onChange={(event) => setDraft((current) => ({ ...current, aiPrompt: event.target.value }))}
                className="mt-1 min-h-20 text-xs"
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--warn)' }}>
                Такая переменная стоит вызова модели на каждое сообщение, где она встретилась.
              </p>
            </div>
          )}
          <Button size="sm" disabled={pending || !draft.name.trim()} onClick={add}>
            <Plus size={14} /> Добавить переменную
          </Button>
        </div>
      </section>
    </main>
  )
}
