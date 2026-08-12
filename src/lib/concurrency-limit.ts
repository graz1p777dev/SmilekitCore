// Простой ограничитель параллелизма для fire-and-forget работы одного
// Node-процесса (без внешних очередей — весь стейт живёт в модуле).
//
// Используется там, где задачи запускаются detached от HTTP-ответа
// (амоCRM-вебхуки, фоновые поллеры) и их количество не ограничено извне:
// без общего лимита параллельные цепочки бьют в тот же fetch-агент/Supabase
// тем же процессом, который обслуживает обычные запросы пользователей —
// те начинают ждать в той же очереди соединений (см. amoCRM overload,
// ПЕРЕДАЧА-CODEX-amocrm-канал.md, «Найденный и доказанный root cause»).

export function createLimiter(maxConcurrent: number) {
  let active = 0
  const queue: (() => void)[] = []

  function runNext() {
    if (active >= maxConcurrent) return
    const task = queue.shift()
    if (!task) return
    active++
    task()
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--
          runNext()
        })
      })
      runNext()
    })
  }
}
