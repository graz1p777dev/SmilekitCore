import { getWhatsappSettings } from '@/actions/whatsapp-settings'
import WhatsappSettingsClient from '@/components/whatsapp/WhatsappSettingsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'WhatsApp: шаблоны и доставка — Smilekit' }

export default async function WhatsappSettingsPage() {
  const config = await getWhatsappSettings()
  if (!config) return <div className="p-8 text-sm text-gray-400">Нет доступа</div>

  return <WhatsappSettingsClient initialConfig={config} />
}
