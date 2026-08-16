// Логи с единым префиксом. Смысл не в «своём логгере», а в том, что по
// grep 'core:greenapi' в Railway видно ровно один канал, а не всё подряд:
// раньше сообщения писались как console.error('greenapi bot-reply: ...')
// вручную, и префикс расходился от файла к файлу.

import type { Logger } from './types'

function write(level: 'info' | 'warn' | 'error', scope: string, message: string, details: unknown[]): void {
  const line = `[${scope}] ${message}`
  if (level === 'error') console.error(line, ...details)
  else if (level === 'warn') console.warn(line, ...details)
  else console.log(line, ...details)
}

export function createLogger(scope: string): Logger {
  return {
    info: (message, ...details) => write('info', scope, message, details),
    warn: (message, ...details) => write('warn', scope, message, details),
    error: (message, ...details) => write('error', scope, message, details),
    child: (child) => createLogger(`${scope}:${child}`),
  }
}

export const log = createLogger('core')
