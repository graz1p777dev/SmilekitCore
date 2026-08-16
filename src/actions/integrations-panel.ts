'use server'

// Страница «Интеграции»: состав системы, переменные и подключение — всё из
// браузера, без деплоя.
//
// Доступ только владельцу: здесь редактируются токены каналов и ключи моделей.
// Значения секретов НИКОГДА не уходят в браузер — наружу отдаётся только
// маска «••••4f2a». Обратной операции «показать секрет» нет намеренно: если
// значение забыто, его вводят заново, а не достают из CRM.

import { revalidatePath } from 'next/cache'
import { ai, listChannels, listModules, vars, isEncryptionConfigured } from '@/core'
import '@/integrations'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getGreenApiState } from '@/lib/greenapi/client'

async function requireOwner(): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return false
  const { data } = await supabase
    .from('employees')
    .select('role')
    .eq('user_id', session.user.id)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as { role?: string } | null)?.role === 'owner'
}

export interface VariableView {
  name: string
  description: string
  required: boolean
  /** Значение задано (в базе или в переменных окружения). */
  isSet: boolean
  /** Что показать: маска секрета или само значение. */
  display: string
  isSecret: boolean
}

export interface IntegrationView {
  id: string
  title: string
  kind: 'channel' | 'module' | 'ai'
  /** Состояние переключателя; null — переключателя у интеграции нет. */
  enabled: boolean | null
  /** Все обязательные переменные заполнены. */
  configured: boolean
  missing: string[]
  variables: VariableView[]
  canTest: boolean
  /** Что умеет ИИ-провайдер: текст, речь, картинки. */
  abilities: string[]
}

export interface PanelData {
  integrations: IntegrationView[]
  /** Переменные, добавленные владельцем сверх объявленных интеграциями. */
  extraVariables: { name: string; display: string; isSecret: boolean; description: string | null }[]
  encryptionReady: boolean
  aiOrder: string
}

const SECRET_HINT = /token|key|secret|password/i

async function describeVariables(
  env: Record<string, { description: string; required?: boolean }>,
  stored: Map<string, { display: string; isSecret: boolean }>
): Promise<VariableView[]> {
  const result: VariableView[] = []
  for (const [name, spec] of Object.entries(env)) {
    const saved = stored.get(name)
    const fromEnv = process.env[name]?.trim()
    result.push({
      name,
      description: spec.description,
      required: Boolean(spec.required),
      isSet: Boolean(saved || fromEnv),
      // Значение из переменных окружения тоже не показываем целиком: на
      // странице это такой же секрет, как и сохранённый в базе.
      display: saved?.display ?? (fromEnv ? 'задано в переменных Railway' : ''),
      isSecret: saved?.isSecret ?? SECRET_HINT.test(name),
    })
  }
  return result
}

export async function getPanelData(): Promise<PanelData | null> {
  if (!(await requireOwner())) return null

  const rows = await vars.listAll()
  let switches: { data: unknown[] | null } = { data: null }
  try {
    switches = await createAdminClient().from('integrations').select('name, is_active')
  } catch {
    // Нет service-ключа (локальная среда) — карточки покажутся без
    // состояния переключателя, страница не падает.
  }
  const stored = new Map(rows.map((row) => [row.name, { display: row.display, isSecret: row.isSecret }]))
  const activeByName = new Map(
    ((switches.data ?? []) as { name: string; is_active: boolean }[]).map((row) => [row.name, row.is_active])
  )

  const integrations: IntegrationView[] = []
  const declared = new Set<string>()

  for (const channel of listChannels()) {
    const env = channel.config?.env ?? {}
    Object.keys(env).forEach((name) => declared.add(name))
    const variables = await describeVariables(env, stored)
    const switchName = channel.guards?.killSwitch ?? null
    integrations.push({
      id: channel.id,
      title: channel.title,
      kind: 'channel',
      enabled: switchName ? (activeByName.get(switchName) ?? false) : null,
      configured: variables.filter((item) => item.required).every((item) => item.isSet),
      missing: variables.filter((item) => item.required && !item.isSet).map((item) => item.name),
      variables,
      canTest: channel.id === 'greenapi',
      abilities: [],
    })
  }

  for (const item of listModules()) {
    const env = item.config?.env ?? {}
    Object.keys(env).forEach((name) => declared.add(name))
    const variables = await describeVariables(env, stored)
    integrations.push({
      id: item.id,
      title: item.title,
      kind: 'module',
      enabled: null,
      configured: variables.filter((item) => item.required).every((item) => item.isSet),
      missing: variables.filter((item) => item.required && !item.isSet).map((item) => item.name),
      variables,
      canTest: false,
      abilities: [],
    })
  }

  const ABILITY_LABELS: Record<string, string> = {
    complete: 'тексты',
    transcribe: 'речь',
    vision: 'картинки',
  }

  for (const provider of ai.status()) {
    const env = provider.env
    Object.keys(env).forEach((name) => declared.add(name))
    const variables = await describeVariables(env, stored)
    integrations.push({
      id: provider.id,
      title: provider.title,
      kind: 'ai',
      enabled: null,
      configured: provider.configured,
      missing: variables.filter((item) => item.required && !item.isSet).map((item) => item.name),
      variables,
      canTest: false,
      abilities: provider.can.map((item) => ABILITY_LABELS[item] ?? item),
    })
  }

  return {
    integrations,
    extraVariables: rows
      .filter((row) => !declared.has(row.name))
      .map((row) => ({
        name: row.name,
        display: row.display,
        isSecret: row.isSecret,
        description: row.description,
      })),
    encryptionReady: isEncryptionConfigured(),
    aiOrder: (await vars.get('AI_PROVIDERS')) ?? 'smilekit-bot,deepseek,openai,gemini',
  }
}

export type ActionResult = { success: true } | { success: false; error: string }

export async function saveVariable(input: {
  name: string
  value: string
  isSecret: boolean
  integrationId?: string | null
  description?: string | null
}): Promise<ActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const result = await vars.save(input)
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath('/dashboard/integrations')
  return { success: true }
}

export async function deleteVariable(name: string): Promise<ActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const result = await vars.remove(name)
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath('/dashboard/integrations')
  return { success: true }
}

/** Переключатель «бот отвечает клиентам» у канала. */
export async function toggleChannel(channelId: string, enabled: boolean): Promise<ActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const channel = listChannels().find((item) => item.id === channelId)
  const name = channel?.guards?.killSwitch
  if (!name) return { success: false, error: 'У этой интеграции нет переключателя' }

  const supabase = createAdminClient()
  const { data: existing } = await supabase.from('integrations').select('id').eq('name', name).maybeSingle()
  const { error } = existing
    ? await supabase.from('integrations').update({ is_active: enabled }).eq('name', name)
    : await supabase.from('integrations').insert({ name, type: 'crm', is_active: enabled })
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/integrations')
  return { success: true }
}

/** «Проверить подключение»: реальный запрос к провайдеру, а не проверка полей. */
export async function testChannel(channelId: string): Promise<{ success: true; details: string } | { success: false; error: string }> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  if (channelId !== 'greenapi') return { success: false, error: 'Проверка для этой интеграции не реализована' }
  try {
    const state = await getGreenApiState()
    return state === 'authorized'
      ? { success: true, details: 'Инстанс авторизован, WhatsApp на связи' }
      : { success: false, error: `Инстанс в состоянии «${state}» — отсканируйте QR в консоли Green API` }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось связаться с Green API' }
  }
}
