import { Suspense } from 'react'
import { getOrdersData } from '@/actions/orders'
import PageLoader from '@/components/common/PageLoader'
import OrdersView from '@/components/orders/OrdersView'

export const dynamic = 'force-dynamic'

async function OrdersData({ orderId }: { orderId: string | null }) {
  const { orders, employees, deals, me } = await getOrdersData()

  if (!me) {
    return <div className="p-8 text-sm" style={{ color: 'var(--ink-3)' }}>Нет доступа</div>
  }

  return (
    <OrdersView
      initialOrders={orders}
      employees={employees}
      deals={deals}
      initialOrderId={orderId}
    />
  )
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  // Уведомление о новом заказе ведёт сюда с ?order=<id> — открываем карточку сразу.
  const { order } = await searchParams

  return (
    <Suspense fallback={<PageLoader />}>
      <OrdersData orderId={order ?? null} />
    </Suspense>
  )
}
