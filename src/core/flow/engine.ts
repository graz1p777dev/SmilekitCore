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
import { activeRules, listTemplates, listVariables, scheduleJob } from './store'
import type { FlowAction, FlowCondition, FlowExecutionContext, FlowRule, FlowVariable } from './types'

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

// Часовой пояс компании: даты и время в переменных должны совпадать с тем,
// что менеджер видит на часах, а не с часовым поясом сервера.
const TIME_ZONE = 'Asia/Bishkek'

function formatNow(source: 'date' | 'time' | 'datetime'): string {
  const now = new Date()
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, day: '2-digit', month: 'long' }).format(now)
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(now)
  if (source === 'date') return date
  if (source === 'time') return time
  return `${date}, ${time}`
}

/**
 * Значение переменной. Всё, кроме 'ai', считается локально и мгновенно;
 * 'ai' — единственный источник, который реально ходит в модель.
 */
async function variableValue(variable: FlowVariable, ctx: FlowExecutionContext): Promise<string> {
  switch (variable.source) {
    case 'date':
    case 'time':
    case 'datetime':
      return formatNow(variable.source)
    case 'client_name':
      return ctx.authorName ?? ''
    case 'client_phone':
      return ctx.chatId
    case 'message':
      return ctx.text
    case 'static':
      return variable.value ?? ''
    case 'ai': {
      if (!variable.aiPrompt?.trim()) return ''
      try {
        const answer = await ai.complete({
          message: ctx.text,
          system:
            `${variable.aiPrompt}\n\n` +
            'Ответь ТОЛЬКО значением, без пояснений и кавычек. ' +
            'Если данных для ответа нет — верни пустую строку.',
          history: ctx.history.map((item) => ({ role: item.role, content: item.content })),
          maxTokens: 120,
        })
        return answer?.trim() ?? ''
      } catch (error) {
        // Переменная не заполнилась — это не повод не отвечать клиенту:
        // подставляем пустую строку и пишем причину в лог.
        ctx.log.error(`переменная {{${variable.name}}}: модель не ответила`, error)
        return ''
      }
    }
    default:
      return ''
  }
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g

/**
 * Подстановки в тексте. Встроенные {{name}}, {{phone}}, {{text}} работают
 * всегда; остальные имена ищутся среди переменных сценария.
 *
 * Значение каждой переменной вычисляется один раз за текст, даже если она
 * встретилась несколько раз — иначе ИИ-переменная стоила бы вызова модели
 * на каждое вхождение.
 */
async function fill(template: string, ctx: FlowExecutionContext): Promise<string> {
  if (!template.includes('{{')) return template.trim()

  const builtin: Record<string, string> = {
    name: ctx.authorName ?? '',
    phone: ctx.chatId,
    text: ctx.text,
  }

  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1])
  if (!names.length) return template.trim()

  const custom = names.some((name) => !(name in builtin)) ? await listVariables() : []
  const resolved = new Map<string, string>()

  for (const name of names) {
    if (resolved.has(name)) continue
    if (name in builtin) {
      resolved.set(name, builtin[name])
      continue
    }
    const variable = custom.find((item) => item.name === name)
    resolved.set(name, variable ? await variableValue(variable, ctx) : '')
  }

  return template.replace(PLACEHOLDER, (_, name: string) => resolved.get(name.trim()) ?? '').trim()
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
      const text = await fill(action.text, ctx)
      if (!text) return true
      return ctx.chat.send({ text })
    }

    case 'template': {
      const template = (await listTemplates()).find((item) => item.id === action.templateId)
      if (!template) {
        // Шаблон удалили, а ветка на него ссылается. Молча пропустить —
        // значит оставить клиента без ответа и не понять почему.
        ctx.log.error(`шаблон ${action.templateId} не найден — шаг пропущен`)
        return true
      }
      const text = await fill(template.text, ctx)
      if (!text) return true
      return ctx.chat.send({ text })
    }

    case 'media': {
      const caption = action.caption ? await fill(action.caption, ctx) : undefined
      return ctx.chat.send({
        media: {
          url: action.url,
          fileName: action.fileName,
          caption,
          voice: action.voice,
        },
        storeText: caption ?? '[файл]',
      })
    }

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
      await crm.notifyTeam({ type: 'sale_lead', title: await fill(action.title, ctx) })
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


/**
 * Ветке разрешено сработать в этом чате?
 *
 * Отметки хранятся в самой переписке (storeOnly-строки), а не в отдельной
 * таблице: у них тот же жизненный цикл, что у диалога, и они автоматически
 * видны при разборе истории чата.
 */
async function passesDedupe(rule: FlowRule, ctx: FlowExecutionContext): Promise<boolean> {
  const mode = rule.dedupe?.mode ?? 'off'
  if (mode === 'off') return true

  const marker = `[ветка ${rule.id}]`

  if (mode === 'once_per_chat') {
    // claim атомарен: одновременные сообщения не проскочат оба.
    return ctx.chat.claim(`rule:${rule.id}`, marker)
  }

  if (mode === 'cooldown') {
    const minutes = Math.max(1, Math.round(rule.dedupe?.minutes ?? 60))
    const lastFiredAt = await ctx.chat.sentAt(marker)
    if (lastFiredAt && Date.now() - lastFiredAt.getTime() < minutes * 60_000) return false
    // Отметка о срабатывании — с уникальным ключом, иначе вторая запись не
    // пройдёт по UNIQUE и «пауза» превратилась бы в «один раз навсегда».
    await ctx.chat.send({ key: `rule:${rule.id}:${Date.now()}`, storeOnly: true, storeText: marker })
    return true
  }

  return true
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

  const execution: FlowExecutionContext = {
    channel: ctx.chat.channel,
    chatId: ctx.chat.id,
    chat: ctx.chat,
    text: ctx.message.text,
    authorName: ctx.message.authorName,
    history: ctx.history,
    deal: ctx.deal,
    log: ctx.log,
    dryRun: ctx.dryRun,
  }

  // Защита от дублей. Проверяется ПОСЛЕ совпадения условий: ветка, которую
  // придержали, не должна отдавать ход следующей — иначе клиент получит
  // ответ от «запасной» ветки вместо тишины, которую владелец и настраивал.
  if (!(await passesDedupe(rule, execution))) {
    ctx.log.info(`сценарий: ветка «${rule.name}» придержана защитой от дублей`)
    return { handled: true, stop: rule.stopAfter }
  }

  ctx.log.info(`сценарий: сработала ветка «${rule.name}»`)
  await executeActions(rule, 0, execution)

  return { handled: true, stop: rule.stopAfter }
}
