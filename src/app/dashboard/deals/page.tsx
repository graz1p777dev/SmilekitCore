import { getDealsData } from '@/actions/deals'
import DealsBoard from '@/components/deals/DealsBoard'

export const dynamic = 'force-dynamic'

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string }>
}) {
  const { stages, deals, employees, me } = await getDealsData()
  const { deal } = await searchParams

  if (!me) {
    return <div className="p-8 text-sm text-gray-400">Нет доступа</div>
  }

  return (
    <DealsBoard
      initialStages={stages}
      initialDeals={deals}
      employees={employees}
      me={me}
      initialOpenDealId={deal ?? null}
    />
  )
}
