'use server'

// Сценарии с канвы: чтение, сохранение, удаление и «примерка» на тексте.
//
// Ветки правит владелец: они управляют тем, что бот говорит клиентам, и
// содержат адреса вебхуков — это тот же уровень доступа, что у промптов.

import { revalidatePath } from 'next/cache'
import { assertPublicHttpUrl, listRules, removeRule, saveRule, matchRule } from '@/core'
import type { FlowAction, FlowCondition, FlowRule } from '@/core'
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
export async function matchFlowRules(
  text: string
): Promise<{ success: true; ruleId: string | null; ruleName: string | null } | { success: false; error: string }> {
  if (!(await requireOwner())) return { success: false, error: 'Нет доступа' }
  const rules = (await listRules(CHANNEL)).filter((rule) => rule.enabled)
  const match = rules.find((rule) =>
    matchRule(rule, {
      text,
      lastBotText: '',
      historyText: '',
      authorName: null,
      isFirstMessage: false,
    })
  )
  return { success: true, ruleId: match?.id ?? null, ruleName: match?.name ?? null }
}
