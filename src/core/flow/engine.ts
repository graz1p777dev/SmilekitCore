// Выполнение сценария, собранного на канве.
//
// Ветки проверяются по порядку, выигрывает первая, у которой совпали ВСЕ
// условия. Действия выполняются подряд; «Подождать» разрывает цепочку —
// остаток доделает планировщик (jobs.ts), когда пауза истечёт.
//
// Всё отправляется через ctx.chat.send — то есть с теми же предохранителями,
// бронью в истории и откатом при сбое, что и обычные ответы бота. Сценарий с
// канвы не может «обойти» правила ядра, и это намеренно.

import { ai } from '../ai'
import { crm } from '../crm'
import { assertPublicHttpUrl, request } from '../http'
import type { DialogContext } from '../types'
import { activeRules, scheduleJob } from './store'
import type { FlowAction, FlowCondition, FlowExecutionContext, FlowRule } from './types'

// Ограничения на пользовательский ввод: regex пишет владелец, а не
// программист, и на длинном тексте неудачное выражение способно надолго
// занять процесс. Длина шаблона и объём проверяемого текста ограничены.
const MAX_PATTERN_LENGTH = 200
const MAX_MATCH_TEXT = 4000

export interface MatchInput {
  text: string
  lastBotText: string
  historyText: string
  authorName: string | null
  isFirstMessage: boolean
}

function fieldValue(field: FlowCondition['field'], input: MatchInput): string {
  if (field === 'last_bot_text') return input.lastBotText
  if (field === 'history') return input.historyText
  if (field === 'author_name') return input.authorName ?? ''
  return input.text
}

export function matchCondition(condition: FlowCondition, input: MatchInput): boolean {
  if (condition.op === 'is_first_message') return input.isFirstMessage

  const haystack = fieldValue(condition.field, input).slice(0, MAX_MATCH_TEXT).toLowerCase()
  const needle = condition.value.trim().toLowerCase()
  if (!needle) return false

  switch (condition.op) {
    case 'contains':
      return haystack.includes(needle)
    case 'not_contains':
      return !haystack.includes(needle)
    case 'equals':
      return haystack.trim() === needle
    case 'matches':
      if (condition.value.length > MAX_PATTERN_LENGTH) return false
      try {
        return new RegExp(condition.value, 'i').test(haystack)
      } catch {
        // Кривое выражение ломает только своё правило — остальные ветки
        // должны продолжать работать.
        return false
      }
    default:
      return false
  }
}

/** Ветка срабатывает, только если совпали все её условия. */
export function matchRule(rule: FlowRule, input: MatchInput): boolean {
  if (!rule.conditions.length) return false // ветка без условий молчит, а не ловит всё
  return rule.conditions.every((condition) => matchCondition(condition, input))
}

/** Подстановки в текстах ответов. */
function fill(template: string, ctx: FlowExecutionContext): string {
  return template
    .replaceAll('{{name}}', ctx.authorName ?? '')
    .replaceAll('{{phone}}', ctx.chatId)
    .replaceAll('{{text}}', ctx.text)
    .trim()
}

/**
 * Выполняет действия ветки начиная с indexFrom.
 * Возвращает индекс, на котором остановились из-за паузы, или null,
 * если цепочка доиграна до конца.
 */
export async function executeActions(
  rule: FlowRule,
  indexFrom: number,
  ctx: FlowExecutionContext
): Promise<number | null> {
  for (let index = indexFrom; index < rule.actions.length; index++) {
    const action = rule.actions[index]

    if (action.type === 'wait') {
      const minutes = Math.max(1, Math.min(60 * 24, Math.round(action.minutes)))
      await scheduleJob({
        ruleId: rule.id,
        channel: ctx.channel,
        chatId: ctx.chatId,
        resumeIndex: index + 1,
        runAt: new Date(Date.now() + minutes * 60_000),
        cancelIfReplied: action.cancelIfReplied !== false,
        state: { externalKey: ctx.deal.externalKey, text: ctx.text, authorName: ctx.authorName },
      })
      return index
    }

    const ok = await runAction(action, ctx)
    // Действие не выполнилось (предохранители, сбой отправки) — обрывать
    // цепочку обязательно: следующие шаги рассчитаны на предыдущие.
    if (!ok) return null
  }
  return null
}

async function runAction(action: FlowAction, ctx: FlowExecutionContext): Promise<boolean> {
  switch (action.type) {
    case 'reply': {
      const text = fill(action.text, ctx)
      if (!text) return true
      return ctx.chat.send({ text })
    }

    case 'media':
      return ctx.chat.send({
        media: {
          url: action.url,
          fileName: action.fileName,
          caption: action.caption ? fill(action.caption, ctx) : undefined,
          voice: action.voice,
        },
        storeText: action.caption ? fill(action.caption, ctx) : '[файл]',
      })

    case 'ai_reply': {
      const answer = await ai
        .complete({
          message: ctx.text,
          system: action.instruction || undefined,
          history: ctx.history.map((item) => ({ role: item.role, content: item.content })),
        })
        .catch((error) => {
          ctx.log.error('сценарий: модель не ответила', error)
          return null
        })
      if (!answer) return false
      return ctx.chat.send({ text: answer })
    }

    case 'stage':
      await ctx.deal.advance(action.action)
      return true

    case 'notify':
      await crm.notifyTeam({ type: 'sale_lead', title: fill(action.title, ctx) })
      return true

    case 'webhook': {
      try {
        assertPublicHttpUrl(action.url)
      } catch (error) {
        ctx.log.error('сценарий: адрес вебхука отклонён', error)
        return true // не повод обрывать разговор с клиентом
      }
      const result = await request(action.url, {
        body: { chatId: ctx.chatId, text: ctx.text, authorName: ctx.authorName, channel: ctx.channel },
        timeoutMs: 10_000,
      })
      if (!result.ok) ctx.log.error(`сценарий: вебхук не ответил — ${result.error}`)
      return true
    }

    default:
      return true
  }
}

export interface FlowResult {
  /** Сработала ветка сценария. */
  handled: boolean
  /** Не продолжать встроенный скрипт продаж. */
  stop: boolean
}

/** Точка входа из конвейера приёма сообщений. */
export async function runFlow(ctx: DialogContext<unknown>): Promise<FlowResult> {
  const rules = await activeRules(ctx.chat.channel)
  if (!rules.length) return { handled: false, stop: false }

  const input: MatchInput = {
    text: ctx.message.text,
    lastBotText: [...ctx.history].reverse().find((item) => item.role === 'assistant')?.content ?? '',
    historyText: ctx.history.map((item) => item.content).join('\n'),
    authorName: ctx.message.authorName,
    isFirstMessage: ctx.history.length === 0,
  }

  const rule = rules.find((candidate) => matchRule(candidate, input))
  if (!rule) return { handled: false, stop: false }

  ctx.log.info(`сценарий: сработала ветка «${rule.name}»`)
  await executeActions(rule, 0, {
    channel: ctx.chat.channel,
    chatId: ctx.chat.id,
    chat: ctx.chat,
    text: ctx.message.text,
    authorName: ctx.message.authorName,
    history: ctx.history,
    deal: ctx.deal,
    log: ctx.log,
    dryRun: ctx.dryRun,
  })

  return { handled: true, stop: rule.stopAfter }
}
