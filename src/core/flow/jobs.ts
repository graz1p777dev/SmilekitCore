// Планировщик отложенных шагов сценария.
//
// Действие «Подождать» разрывает цепочку: остаток ветки доигрывается здесь,
// когда пауза истекла. Тик раз в 30 секунд — точности до секунды сценариям
// продаж не нужно, а частые опросы базы стоят дороже, чем дают.
//
// Один инстанс на Railway, как у остальных планировщиков проекта. Даже если
// инстансов станет больше, захват шага атомарный (см. claimDueJobs).

import { hasClientMessageSince } from '../conversation'
import { crm } from '../crm'
import { createLogger } from '../logger'
import { chatOf } from '../messaging'
import { history as loadHistory } from '../conversation'
import { executeActions } from './engine'
import { claimDueJobs, finishJob, getRule } from './store'

const TICK_INTERVAL_MS = 30_000

let started = false

export function startFlowScheduler(): void {
  if (started) return
  started = true
  console.log('[flow] планировщик отложенных шагов запущен')
  const tick = () => {
    void runOnce().catch((error) => console.error('[flow] планировщик упал', error))
  }
  tick()
  setInterval(tick, TICK_INTERVAL_MS).unref?.()
}

export async function runOnce(): Promise<void> {
  const jobs = await claimDueJobs()

  for (const job of jobs) {
    const log = createLogger(`core:${job.channel}:flow`)
    try {
      const rule = await getRule(job.ruleId)
      if (!rule || !rule.enabled) {
        await finishJob(job.id, 'cancelled')
        continue
      }

      // Клиент ответил за время паузы — отложенный шаг почти всегда теряет
      // смысл («вам оформить?» после того, как клиент уже написал сам,
      // выглядит как разговор с самим собой).
      if (job.cancelIfReplied && (await hasClientMessageSince(job.chatId, job.createdAt))) {
        await finishJob(job.id, 'cancelled')
        continue
      }

      const chat = chatOf(job.channel, job.chatId)
      if (!(await chat.canReply())) {
        await finishJob(job.id, 'cancelled')
        continue
      }

      const externalKey = job.state.externalKey ?? `${job.channel}:${job.chatId}`
      const stopped = await executeActions(rule, job.resumeIndex, {
        channel: job.channel,
        chatId: job.chatId,
        chat,
        text: job.state.text ?? '',
        authorName: job.state.authorName ?? null,
        history: await loadHistory(job.chatId, { limit: 30 }),
        deal: {
          externalKey,
          advance: (action: string) => crm.advanceStage(job.channel, externalKey, action),
        },
        log,
        dryRun: false,
      })

      // Внутри ветки может быть несколько пауз: следующая уже запланирована
      // отдельным шагом, а этот считаем выполненным.
      await finishJob(job.id, 'done')
      if (stopped !== null) log.info(`сценарий «${rule.name}»: следующая пауза после шага ${stopped + 1}`)
    } catch (error) {
      await finishJob(job.id, 'failed', error instanceof Error ? error.message : 'неизвестная ошибка')
    }
  }
}
