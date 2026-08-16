// Порядок и параллелизм фоновой обработки.
//
// Два разных ограничения, которые раньше жили копиями в каждом канале:
//   serial(key)  — сообщения ОДНОГО чата обрабатываются строго по очереди,
//                  иначе два сообщения подряд отвечают друг другу поперёк
//                  и в историю попадает каша;
//   limiter      — общий потолок параллельных цепочек на процесс: вебхуки
//                  приходят пачками и без потолка забивают тот же пул
//                  соединений, которым пользуются страницы CRM (доказанный
//                  root cause зависаний, см. ПЕРЕДАЧА-CODEX-amocrm-канал.md).

import { createLimiter } from '@/lib/concurrency-limit'

const MAX_PARALLEL_CHATS = 4

const chains = new Map<string, Promise<void>>()
const limit = createLimiter(MAX_PARALLEL_CHATS)

/**
 * Ставит задачу в хвост очереди ключа. Возвращает промис именно этой задачи
 * (не всей цепочки) — вызывающий видит свою ошибку, а очередь не рвётся.
 */
export function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const run = previous.then(() => limit(task))
  const chain = run.then(
    () => {},
    () => {}
  )
  chains.set(key, chain)
  chain.then(() => {
    // Не чистим чужую цепочку: за время выполнения ключ мог получить новую.
    if (chains.get(key) === chain) chains.delete(key)
  })
  return run
}

/** Пауза. Вынесена сюда, чтобы политики не плодили свои setTimeout-обёртки. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
