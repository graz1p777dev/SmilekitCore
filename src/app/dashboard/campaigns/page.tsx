import { getCampaignsData } from '@/actions/campaigns'
import CampaignsClient from '@/components/campaigns/CampaignsClient'

export const dynamic = 'force-dynamic'

export default async function CampaignsPage() {
  const data = await getCampaignsData()
  return <CampaignsClient initialData={data} />
}
