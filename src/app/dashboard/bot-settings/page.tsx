import { getBotSettings } from '@/actions/smilekit-bot-settings'
import { SmilekitBotSettingsClient } from '@/components/bot/SmilekitBotSettingsClient'
import { SmilekitBotApiError } from '@/components/bot/SmilekitBotApiError'

// Бот — отдельный сервис (aiogram, Railway smilekit-bot), не часть CRM:
// настройки читаются и пишутся через его внутренний API на сервере, чтобы
// SMILEKIT_BOT_INTERNAL_TOKEN не попал в браузер.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Настройки бота — Smilekit' }

export default async function BotSettingsPage() {
  const result = await getBotSettings()
  if (!result.ok) return <SmilekitBotApiError error={result.error} />

  return <SmilekitBotSettingsClient settings={result.data} />
}
