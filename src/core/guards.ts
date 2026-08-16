// Предохранители: четыре независимые причины, по которым бот обязан молчать.
// Раньше они были скопированы в каждый канал — и расходились: в одном канале
// проверка отписки была, в другом нет.
//
// Важно: молчание бота НЕ отменяет ведение истории и движение этапов сделки.
// Выключенный бот — это «не отвечай», а не «не работай»: менеджер должен
// видеть переписку и воронку в любом случае.

import { createAdminClient } from '@/lib/supabase/admin'
import { lastOperatorAt } from './conversation'
import { vars } from './variables'
import type { ChannelGuards } from './types'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Аварийный выключатель: строка в integrations. Ошибку чтения трактуем как
 * «выключено» — если состояние рубильника неизвестно, безопаснее промолчать,
 * чем отвечать клиентам вопреки выключенному боту.
 */
export async function killSwitchOn(supabase: Admin, name: string): Promise<boolean> {
  const { data, error } = await supabase.from('integrations').select('is_active').eq('name', name).maybeSingle()
  if (error) return false
  return Boolean((data as { is_active?: boolean } | null)?.is_active)
}

/**
 * В чат вмешался живой менеджер — бот больше не лезет.
 *
 * Источников два: факт исходящего от оператора (sender='operator') и ручной
 * переключатель на странице «Диалоги» (amocrm_chat_control). Побеждает более
 * свежий: если менеджер написал ПОСЛЕ того, как бота включили обратно, чат
 * снова за менеджером; если бота включили после сообщения менеджера — бот
 * возвращается в разговор.
 */
export async function managerControlsChat(supabase: Admin, chatId: string): Promise<boolean> {
  const [operatorAt, controlResult] = await Promise.all([
    lastOperatorAt(chatId),
    supabase.from('amocrm_chat_control').select('bot_enabled, updated_at').eq('chat_id', chatId).maybeSingle(),
  ])
  const control = controlResult.data as { bot_enabled: boolean; updated_at: string } | null
  if (!control) return operatorAt !== null
  const overrideIsFresh = operatorAt === null || new Date(control.updated_at).getTime() > operatorAt
  if (overrideIsFresh) return !control.bot_enabled
  return true
}

/** Клиент отписан от бота (рассылки/жалоба) — отвечать нельзя. */
export async function optedOut(supabase: Admin, chatId: string): Promise<boolean> {
  const phone = String(chatId || '').replace(/\D/g, '')
  if (!phone) return false
  const { data } = await supabase
    .from('campaign_opt_outs')
    .select('phone')
    .eq('phone', phone)
    .eq('block_bot_replies', true)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Обкатка на своих номерах: пока переменная не пуста, бот отвечает только
 * перечисленным. Остальным клиентам история и сделки ведутся как обычно.
 * Пустая переменная — обычный режим, отвечаем всем.
 */
export async function allowedByList(varName: string | undefined, chatId: string): Promise<boolean> {
  if (!varName) return true
  const allowed = (await vars.list(varName)).map((value) => value.replace(/\D/g, ''))
  return allowed.length === 0 || allowed.includes(chatId.replace(/\D/g, ''))
}

export interface GuardOptions {
  /** Лаборатория: не трогать реальный аварийный выключатель. */
  skipKillSwitch?: boolean
}

/** Итоговое «можно ли сейчас отвечать в этот чат». */
export async function canReply(
  supabase: Admin,
  chatId: string,
  guards: ChannelGuards = {},
  options: GuardOptions = {}
): Promise<boolean> {
  if (!(await allowedByList(guards.allowlistEnv, chatId))) return false

  const [switchOn, manager, blocked] = await Promise.all([
    guards.killSwitch && !options.skipKillSwitch ? killSwitchOn(supabase, guards.killSwitch) : Promise.resolve(true),
    managerControlsChat(supabase, chatId),
    guards.respectOptOut ? optedOut(supabase, chatId) : Promise.resolve(false),
  ])

  return switchOn && !manager && !blocked
}
