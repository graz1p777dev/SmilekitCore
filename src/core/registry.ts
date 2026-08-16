// Реестр интеграций.
//
// Регистрация статическая: манифест src/integrations/index.ts импортирует
// каждую интеграцию и зовёт register(). Никакого автопоиска по файлам и
// динамических импортов — включённость интеграции должна быть видна глазами
// в одном файле, а не выводиться из того, что лежит на диске.

import { log } from './logger'
import type { ChannelIntegration, ModuleIntegration } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
const channels = new Map<string, ChannelIntegration<any>>()
const modules = new Map<string, ModuleIntegration<any>>()

export function register(integration: ChannelIntegration<any> | ModuleIntegration<any>): void {
  const target = integration.kind === 'channel' ? channels : modules
  const existing = target.get(integration.id)
  // Повторная регистрация того же объекта — это перезагрузка модуля в dev
  // (HMR), а не ошибка. Разные объекты с одним id — уже ошибка конфигурации,
  // но падать из-за неё на проде хуже, чем работать с последним и сказать.
  if (existing === integration) return
  if (existing) log.warn(`интеграция ${integration.id} переопределена`)

  if (integration.kind === 'channel') {
    channels.set(integration.id, integration)
    return
  }
  modules.set(integration.id, integration)
  // Подписки модуля ставятся один раз, при регистрации — так модуль не обязан
  // никем вызываться, чтобы начать реагировать на события ядра.
  try {
    integration.setup?.()
  } catch (error) {
    log.error(`модуль ${integration.id}: setup упал`, error)
  }
}

export function getChannel(id: string): ChannelIntegration<any> | null {
  return channels.get(id) ?? null
}

export function requireChannel(id: string): ChannelIntegration<any> {
  const channel = channels.get(id)
  if (!channel) throw new Error(`канал ${id} не зарегистрирован (см. src/integrations/index.ts)`)
  return channel
}

export function listChannels(): ChannelIntegration<any>[] {
  return [...channels.values()]
}

export function listModules(): ModuleIntegration<any>[] {
  return [...modules.values()]
}
/* eslint-enable @typescript-eslint/no-explicit-any */
