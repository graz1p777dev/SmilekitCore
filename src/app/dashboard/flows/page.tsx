import { getFlowRules } from '@/actions/flows'
import FlowCanvas from '@/components/flows/FlowCanvas'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Сценарии — Smilekit' }

export default async function FlowsPage() {
  const rules = await getFlowRules()
  if (!rules) return <div className="p-8 text-sm text-gray-400">Нет доступа</div>

  return <FlowCanvas initial={rules} />
}
