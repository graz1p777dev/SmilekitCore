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

import { useCallback, useMemo, useState, useTransition } from 'react'
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
import { Bell, Bot, Clock, GitBranch, Image, MessageSquare, Plus, Save, Send, Trash2, Webhook, Zap } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { deleteFlowRule, matchFlowRules, saveFlowRule } from '@/actions/flows'
import type { FlowAction, FlowActionType, FlowCondition, FlowRule } from '@/core'

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
  media: 'Отправить файл',
  wait: 'Подождать',
  ai_reply: 'Ответ модели',
  stage: 'Двинуть этап сделки',
  notify: 'Уведомить менеджеров',
  webhook: 'Дёрнуть вебхук',
}

const ACTION_ICONS: Record<FlowActionType, typeof MessageSquare> = {
  reply: MessageSquare,
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

function actionSummary(action: FlowAction): string {
  switch (action.type) {
    case 'reply':
      return action.text || 'текст не задан'
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

const TONE_STYLES: Record<NodeData['tone'], string> = {
  trigger: 'border-violet-300 bg-violet-50',
  condition: 'border-amber-300 bg-amber-50',
  action: 'border-gray-200 bg-white',
}

function FlowNode({ data, selected }: NodeProps) {
  const item = data as NodeData
  const Icon = item.icon ?? GitBranch
  return (
    <div
      className={`w-56 rounded-2xl border-2 px-3 py-2.5 shadow-sm transition ${TONE_STYLES[item.tone]} ${
        selected ? 'ring-2 ring-violet-400' : ''
      } ${item.disabled ? 'opacity-50' : ''}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className="flex items-center gap-2">
        <Icon size={14} className="shrink-0 text-gray-600" />
        <p className="truncate text-xs font-bold text-gray-900">{item.label}</p>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-500">{item.sub}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  )
}

const nodeTypes = { flow: FlowNode }

const COLUMN_WIDTH = 260
const ROW_HEIGHT = 110

// ─── Страница ────────────────────────────────────────────────────────────

export default function FlowCanvas({ initial }: { initial: FlowRule[] }) {
  const [rules, setRules] = useState<FlowRule[]>(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [probe, setProbe] = useState('')

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
          label: 'Клиент написал',
          sub: 'Входящее сообщение в WhatsApp',
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
            sub: actionSummary(action),
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
  }, [rules])

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
      const result = await matchFlowRules(probe)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.ruleName ? `Сработает: «${result.ruleName}»` : 'Ни одна ветка не совпала — ответит скрипт продаж')
    })
  }

  const selectedRule = selected?.startsWith('rule:')
    ? rules.find((rule) => `rule:${rule.id}` === selected)
    : selected?.startsWith('action:')
      ? rules.find((rule) => rule.id === selected.split(':')[1])
      : null
  const selectedActionIndex = selected?.startsWith('action:') ? Number(selected.split(':')[2]) : null

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--surface-2)' }}>
      <PageHeader
        title="Сценарии"
        subtitle="Если клиент написал — ответить, подождать, сделать. Собирается мышкой, применяется сразу"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRule} disabled={pending}>
              <Plus size={14} /> Новая ветка
            </Button>
            <Button size="sm" onClick={saveAll} disabled={pending || dirty.size === 0}>
              <Save size={14} /> Сохранить{dirty.size ? ` (${dirty.size})` : ''}
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="h-[420px] min-w-0 flex-1 lg:h-auto">
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
            <Background gap={16} color="#e5e0e0" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-5 lg:w-[420px]">
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

              <div className="rounded-2xl bg-gray-50 p-4">
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
  'mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-gray-400'

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

      <div>
        <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
          Условия — должны совпасть все
        </p>
        <div className="mt-2 space-y-3">
          {rule.conditions.map((condition, index) => (
            <div key={index} className="rounded-2xl bg-gray-50 p-3">
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
  onChange,
  onSelect,
}: {
  rule: FlowRule
  index: number
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
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-3)' }}>
            Подстановки: {'{{name}}'} — имя клиента, {'{{phone}}'} — номер, {'{{text}}'} — что он написал
          </p>
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

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
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
