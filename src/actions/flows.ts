'use server'

// Сценарии с канвы: чтение, сохранение, удаление и «примерка» на тексте.
//
// Ветки правит владелец: они управляют тем, что бот говорит клиентам, и
// содержат адреса вебхуков — это тот же уровень доступа, что у промптов.

import { revalidatePath } from 'next/cache'
import { assertPublicHttpUrl, listRules, removeRule, saveRule, matchRule } from '@/core'
import {
  listTemplates,
  listVariables,
  removeTemplate,
  removeVariable,
  saveTemplate,
  saveVariable,
} from '@/core/flow/store'
import type { FlowAction, FlowCondition, FlowRule, FlowTemplate, FlowVariable } from '@/core'
import { createClient } from '@/lib/supabase/server'

const CHANNEL = 'greenapi'

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

export async function getFlowRules(): Promise<FlowRule[] | null> {
  if (!(await requireOwner())) return null
  return listRules(CHANNEL)
}

export type FlowActionResult = { success: true; id?: string } | { success: false; error: string }

const MAX_ACTIONS = 20
const MAX_CONDITIONS = 10
const MAX_TEXT = 4000

/**
 * Проверка того, что пришло из браузера. Клиентской валидации мало: действия
 * исполняет сервер и часть из них ходит в сеть — адреса вебхуков и файлов
 * проверяются здесь, а не только в форме.
 */
function validate(rule: FlowRule): string | null {
  if (!rule.name.trim()) return 'У ветки должно быть название'
  if (rule.conditions.length > MAX_CONDITIONS) return `Условий не больше ${MAX_CONDITIONS}`
  if (rule.actions.length > MAX_ACTIONS) return `Действий не больше ${MAX_ACTIONS}`

  for (const condition of rule.conditions as FlowCondition[]) {
    if (condition.op !== 'is_first_message' && !condition.value.trim()) return 'Заполните значение условия'
    if (condition.op === 'matches') {
      try {
        new RegExp(condition.value)
      } catch {
        return `Некорректное регулярное выражение: ${condition.value}`
      }
    }
  }

  for (const action of rule.actions as FlowAction[]) {
    if (action.type === 'reply' && action.text.length > MAX_TEXT) return 'Слишком длинный текст ответа'
    if (action.type === 'wait' && (!Number.isFinite(action.minutes) || action.minutes < 1)) {
      return 'Пауза — целое число минут, минимум 1'
    }
    if (action.type === 'webhook' || action.type === 'media') {
      const url = action.type === 'webhook' ? action.url : action.url
      try {
        assertPublicHttpUrl(url)
      } catch (error) {
        return error instanceof Error ? error.message : 'Некорректный адрес'
      }
    }
  }
  return null
}

export async function saveFlowRule(rule: FlowRule): Promise<FlowActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }

  const problem = validate(rule)
  if (problem) return { success: false, error: problem }

  const result = await saveRule({
    id: rule.id || undefined,
    channel: CHANNEL,
    name: rule.name.trim(),
    enabled: rule.enabled,
    position: rule.position,
    conditions: rule.conditions,
    actions: rule.actions,
    stopAfter: rule.stopAfter,
    dedupe: rule.dedupe ?? { mode: 'off' },
    layout: rule.layout ?? {},
  })
  if (!result.ok) return { success: false, error: result.error }

  revalidatePath('/dashboard/flows')
  return { success: true, id: result.id }
}

export async function deleteFlowRule(id: string): Promise<FlowActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const result = await removeRule(id)
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath('/dashboard/flows')
  return { success: true }
}

/**
 * «Примерка»: какая ветка сработала бы на этом тексте. Ничего не отправляет
 * и никуда не пишет — просто прогоняет условия.
 */
export interface ProbeResult {
  ruleId: string | null
  ruleName: string | null
  /** Человеческое объяснение, почему получилось именно так. */
  explanation: string
}

export async function matchFlowRules(
  text: string
): Promise<{ success: true; result: ProbeResult } | { success: false; error: string }> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }

  const all = await listRules(CHANNEL)
  const probe = { text, lastBotText: '', historyText: '', authorName: null, isFirstMessage: false }

  const match = all.filter((rule) => rule.enabled).find((rule) => matchRule(rule, probe))
  if (match) {
    return {
      success: true,
      result: { ruleId: match.id, ruleName: match.name, explanation: `Сработает ветка «${match.name}»` },
    }
  }

  // Ни одна не сработала — объясняем причину, а не отделываемся общей фразой.
  // Чаще всего ветку только что создали: она выключена и без условий.
  const disabledMatch = all.filter((rule) => !rule.enabled).find((rule) => matchRule(rule, probe))
  if (disabledMatch) {
    return {
      success: true,
      result: {
        ruleId: disabledMatch.id,
        ruleName: disabledMatch.name,
        explanation: `Условия ветки «${disabledMatch.name}» подходят, но она выключена — включите её в настройках ветки`,
      },
    }
  }

  const empty = all.filter((rule) => !rule.conditions.length)
  if (empty.length) {
    return {
      success: true,
      result: {
        ruleId: null,
        ruleName: null,
        explanation: `У ветки «${empty[0].name}» не заданы условия — она не сработает никогда. Добавьте условие`,
      },
    }
  }

  return {
    success: true,
    result: {
      ruleId: null,
      ruleName: null,
      explanation: all.length
        ? 'Ни одна ветка не совпала — ответит встроенный скрипт продаж'
        : 'Веток пока нет — отвечает встроенный скрипт продаж',
    },
  }
}

// ─── Шаблоны ─────────────────────────────────────────────────────────────

export async function getFlowTemplates(): Promise<FlowTemplate[] | null> {
  if (!(await requireOwner())) return null
  return listTemplates()
}

export async function saveFlowTemplate(
  input: { id?: string; name: string; text: string }
): Promise<FlowActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const name = input.name.trim()
  const value = input.text.trim()
  if (!name) return { success: false, error: 'У шаблона должно быть название' }
  if (!value) return { success: false, error: 'Шаблон не может быть пустым' }
  if (value.length > MAX_TEXT) return { success: false, error: 'Слишком длинный текст' }

  const result = await saveTemplate({ id: input.id, name, text: value })
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath('/dashboard/flows')
  return { success: true, id: result.id }
}

export async function deleteFlowTemplate(id: string): Promise<FlowActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const result = await removeTemplate(id)
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath('/dashboard/flows')
  return { success: true }
}

// ─── Переменные ──────────────────────────────────────────────────────────

export async function getFlowVariables(): Promise<FlowVariable[] | null> {
  if (!(await requireOwner())) return null
  return listVariables()
}

export async function saveFlowVariable(
  input: { id?: string; name: string; source: FlowVariable['source']; aiPrompt?: string | null; value?: string | null }
): Promise<FlowActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }

  const name = input.name.trim()
  // Имя попадает в {{...}} и сравнивается буквально: пробелы и фигурные
  // скобки внутри имени сделали бы подстановку неработающей и непонятной.
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]{1,40}$/.test(name)) {
    return { success: false, error: 'Имя: буквы, цифры и _, до 40 символов, без пробелов' }
  }
  if (input.source === 'ai' && !input.aiPrompt?.trim()) {
    return { success: false, error: 'Для ИИ-переменной нужен промпт — что именно в неё положить' }
  }
  if (input.source === 'static' && !input.value?.trim()) {
    return { success: false, error: 'Укажите значение' }
  }

  const result = await saveVariable({
    id: input.id,
    name,
    source: input.source,
    aiPrompt: input.aiPrompt ?? null,
    value: input.value ?? null,
  })
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath('/dashboard/flows')
  return { success: true, id: result.id }
}

export async function deleteFlowVariable(id: string): Promise<FlowActionResult> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const result = await removeVariable(id)
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath('/dashboard/flows')
  return { success: true }
}
