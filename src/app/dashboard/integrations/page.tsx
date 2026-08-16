import { getPanelData } from '@/actions/integrations-panel'
import IntegrationsClient from '@/components/integrations/IntegrationsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Интеграции — Smilekit' }

export default async function IntegrationsPage() {
  const data = await getPanelData()
  if (!data) return <div className="p-8 text-sm text-gray-400">Нет доступа</div>

  return <IntegrationsClient initial={data} />
}
