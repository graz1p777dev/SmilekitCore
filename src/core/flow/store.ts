// Хранение веток сценария.
//
// Чтение на каждое входящее сообщение кэшируется на 10 секунд: правки с
// канвы должны применяться почти сразу (владелец сохранил — проверил в
// Лаборатории), но и запрос на каждое сообщение здесь ни к чему.

import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '../logger'
import type { FlowAction, FlowCondition, FlowDedupe, FlowRule, FlowTemplate, FlowVariable } from './types'

const TABLE = 'flow_rules'
const CACHE_TTL_MS = 10_000

let cache: { rules: FlowRule[]; loadedAt: number } | null = null

export function invalidate(): void {
  cache = null
}

interface Row {
  id: string
  channel: string
  name: string
  enabled: boolean
  position: number
  conditions: FlowCondition[] | null
  actions: FlowAction[] | null
  stop_after: boolean
  dedupe: FlowDedupe | null
  layout: Record<string, { x: number; y: number }> | null
}

function toRule(row: Row): FlowRule {
  return {
    id: row.id,
    channel: row.channel,
    name: row.name,
    enabled: row.enabled,
    position: row.position,
    conditions: row.conditions ?? [],
    actions: row.actions ?? [],
    stopAfter: row.stop_after,
    dedupe: row.dedupe ?? { mode: 'off' },
    layout: row.layout ?? {},
  }
}

async function loadAll(): Promise<FlowRule[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rules

  // Любая причина недоступности (нет service-ключа в локальной среде,
  // миграция не применена, база недоступна) деградирует одинаково: бот
  // работает по встроенному скрипту, без сценариев с канвы.
  let data: unknown[] | null = null
  try {
    const result = await createAdminClient()
      .from(TABLE)
      .select('id, channel, name, enabled, position, conditions, actions, stop_after, dedupe, layout')
      .order('position')
    if (result.error) {
      log.warn(`сценарии недоступны: ${result.error.message}`)
      return []
    }
    data = result.data
  } catch (error) {
    log.warn('сценарии недоступны', error)
    return []
  }

  const rules = (data ?? []).map((row) => toRule(row as Row))
  cache = { rules, loadedAt: Date.now() }
  return rules
}

/** Включённые ветки канала — то, что выполняется на входящем сообщении. */
export async function activeRules(channel: string): Promise<FlowRule[]> {
  return (await loadAll()).filter((rule) => rule.enabled && rule.channel === channel)
}

export async function listRules(channel: string): Promise<FlowRule[]> {
  invalidate()
  return (await loadAll()).filter((rule) => rule.channel === channel)
}

export async function getRule(id: string): Promise<FlowRule | null> {
  return (await loadAll()).find((rule) => rule.id === id) ?? null
}

export type SaveRuleInput = Omit<FlowRule, 'id'> & { id?: string }

export async function saveRule(input: SaveRuleInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const row = {
    ...(input.id ? { id: input.id } : {}),
    channel: input.channel,
    name: input.name,
    enabled: input.enabled,
    position: input.position,
    conditions: input.conditions,
    actions: input.actions,
    stop_after: input.stopAfter,
    dedupe: input.dedupe,
    layout: input.layout,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await createAdminClient().from(TABLE).upsert(row).select('id').maybeSingle()
  if (error) return { ok: false, error: error.message }
  invalidate()
  return { ok: true, id: (data as { id: string }).id }
}

export async function removeRule(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createAdminClient().from(TABLE).delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  invalidate()
  return { ok: true }
}

// ─── Отложенные шаги (действие «Подождать») ──────────────────────────────

const JOBS_TABLE = 'flow_jobs'

export interface FlowJob {
  id: number
  ruleId: string
  channel: string
  chatId: string
  resumeIndex: number
  cancelIfReplied: boolean
  createdAt: string
  state: { externalKey?: string; text?: string; authorName?: string | null }
}

export interface ScheduleJobInput {
  ruleId: string
  channel: string
  chatId: string
  resumeIndex: number
  runAt: Date
  cancelIfReplied: boolean
  state: FlowJob['state']
}

export async function scheduleJob(input: ScheduleJobInput): Promise<void> {
  const { error } = await createAdminClient().from(JOBS_TABLE).insert({
    rule_id: input.ruleId,
    channel: input.channel,
    chat_id: input.chatId,
    resume_index: input.resumeIndex,
    run_at: input.runAt.toISOString(),
    cancel_if_replied: input.cancelIfReplied,
    state: input.state,
  })
  if (error) log.error(`пауза сценария не запланирована: ${error.message}`)
}

/**
 * Забирает созревшие шаги в работу. Смена статуса на 'running' условием
 * `status = 'pending'` делает захват атомарным: наложившийся тик не выполнит
 * тот же шаг второй раз.
 */
export async function claimDueJobs(limit = 25): Promise<FlowJob[]> {
  const supabase = createAdminClient()
  const { data: due } = await supabase
    .from(JOBS_TABLE)
    .select('id')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at')
    .limit(limit)
  if (!due?.length) return []

  const ids = (due as { id: number }[]).map((row) => row.id)
  const { data: claimed, error } = await supabase
    .from(JOBS_TABLE)
    .update({ status: 'running' })
    .in('id', ids)
    .eq('status', 'pending')
    .select('id, rule_id, channel, chat_id, resume_index, cancel_if_replied, created_at, state')
  if (error) {
    log.error(`шаги сценария не забрались в работу: ${error.message}`)
    return []
  }

  return (claimed ?? []).map((row) => {
    const item = row as {
      id: number
      rule_id: string
      channel: string
      chat_id: string
      resume_index: number
      cancel_if_replied: boolean
      created_at: string
      state: FlowJob['state'] | null
    }
    return {
      id: item.id,
      ruleId: item.rule_id,
      channel: item.channel,
      chatId: item.chat_id,
      resumeIndex: item.resume_index,
      cancelIfReplied: item.cancel_if_replied,
      createdAt: item.created_at,
      state: item.state ?? {},
    }
  })
}

export async function finishJob(
  id: number,
  status: 'done' | 'cancelled' | 'failed',
  error?: string
): Promise<void> {
  await createAdminClient()
    .from(JOBS_TABLE)
    .update({ status, error: error ?? null, finished_at: new Date().toISOString() })
    .eq('id', id)
}

// ─── Шаблоны и переменные ────────────────────────────────────────────────
//
// Кэш общий с ветками по смыслу (10 секунд): подстановки читаются на каждое
// сообщение, а правятся редко.

const TEMPLATES_TABLE = 'flow_templates'
const VARIABLES_TABLE = 'flow_variables'

let templatesCache: { items: FlowTemplate[]; loadedAt: number } | null = null
let variablesCache: { items: FlowVariable[]; loadedAt: number } | null = null

export function invalidateAssets(): void {
  templatesCache = null
  variablesCache = null
}

export async function listTemplates(): Promise<FlowTemplate[]> {
  if (templatesCache && Date.now() - templatesCache.loadedAt < CACHE_TTL_MS) return templatesCache.items
  try {
    const { data, error } = await createAdminClient()
      .from(TEMPLATES_TABLE)
      .select('id, name, text')
      .order('name')
    if (error) {
      log.warn(`шаблоны недоступны: ${error.message}`)
      return []
    }
    const items = (data ?? []) as FlowTemplate[]
    templatesCache = { items, loadedAt: Date.now() }
    return items
  } catch {
    return []
  }
}

export async function saveTemplate(
  input: { id?: string; name: string; text: string }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await createAdminClient()
    .from(TEMPLATES_TABLE)
    .upsert({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      text: input.text,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  invalidateAssets()
  return { ok: true, id: (data as { id: string }).id }
}

export async function removeTemplate(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createAdminClient().from(TEMPLATES_TABLE).delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  invalidateAssets()
  return { ok: true }
}

interface VariableRow {
  id: string
  name: string
  source: FlowVariable['source']
  ai_prompt: string | null
  value: string | null
}

export async function listVariables(): Promise<FlowVariable[]> {
  if (variablesCache && Date.now() - variablesCache.loadedAt < CACHE_TTL_MS) return variablesCache.items
  try {
    const { data, error } = await createAdminClient()
      .from(VARIABLES_TABLE)
      .select('id, name, source, ai_prompt, value')
      .order('name')
    if (error) {
      log.warn(`переменные сценария недоступны: ${error.message}`)
      return []
    }
    const items = ((data ?? []) as VariableRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source,
      aiPrompt: row.ai_prompt,
      value: row.value,
    }))
    variablesCache = { items, loadedAt: Date.now() }
    return items
  } catch {
    return []
  }
}

export async function saveVariable(
  input: { id?: string; name: string; source: FlowVariable['source']; aiPrompt?: string | null; value?: string | null }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await createAdminClient()
    .from(VARIABLES_TABLE)
    .upsert({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      source: input.source,
      ai_prompt: input.aiPrompt ?? null,
      value: input.value ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  invalidateAssets()
  return { ok: true, id: (data as { id: string }).id }
}

export async function removeVariable(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createAdminClient().from(VARIABLES_TABLE).delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  invalidateAssets()
  return { ok: true }
}
