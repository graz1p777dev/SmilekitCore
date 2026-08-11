'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface CampaignRow {
  id: string
  title: string
  message: string
  scheduled_at: string
  status: 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed'
  recipient_count: number
  sent_count: number
  failed_count: number
  created_at: string
}

export interface CampaignsData {
  campaigns: CampaignRow[]
  eligibleCount: number
}

type Recipient = {
  deal_id: string
  channel: 'telegram' | 'whatsapp' | 'instagram'
  external_key: string
  chat_id: string
  lead_id: string | null
  contact_id: string | null
}

async function viewer() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data } = await supabase
    .from('employees')
    .select('id, role')
    .eq('user_id', session.user.id)
    .is('deleted_at', null)
    .maybeSingle()
  return data as { id: string; role: string } | null
}

async function eligibleRecipients(): Promise<Recipient[]> {
  const admin = createAdminClient()
  const [{ data: deals }, { data: orders }, { data: amoMessages }] = await Promise.all([
    admin
      .from('deals')
      .select('id, source, external_key')
      .neq('status', 'won')
      .is('deleted_at', null),
    admin
      .from('orders')
      .select('deal_id')
      .neq('status', 'cancelled')
      .is('deleted_at', null),
    admin
      .from('amocrm_messages')
      .select('id, chat_id, lead_id, contact_id, sender')
      .order('id', { ascending: false }),
  ])
  const purchased = new Set((orders ?? []).flatMap((row) => row.deal_id ? [String(row.deal_id)] : []))
  const managerChats = new Set(
    (amoMessages ?? []).filter((row) => row.sender === 'operator').map((row) => String(row.chat_id))
  )
  const amoByLead = new Map<string, { chatId: string; contactId: string | null }>()
  for (const row of amoMessages ?? []) {
    if (!row.lead_id || amoByLead.has(String(row.lead_id))) continue
    amoByLead.set(String(row.lead_id), {
      chatId: String(row.chat_id),
      contactId: row.contact_id ? String(row.contact_id) : null,
    })
  }

  return (deals ?? []).flatMap((deal): Recipient[] => {
    const id = String(deal.id)
    const key = String(deal.external_key || '')
    if (!key || purchased.has(id)) return []
    if (deal.source === 'telegram' && key.startsWith('telegram:')) {
      const chatId = key.slice('telegram:'.length)
      return /^-?\d+$/.test(chatId) ? [{
        deal_id: id,
        channel: 'telegram',
        external_key: key,
        chat_id: chatId,
        lead_id: null,
        contact_id: null,
      }] : []
    }
    if ((deal.source === 'whatsapp' || deal.source === 'instagram') && key.startsWith('amocrm:')) {
      const leadId = key.slice('amocrm:'.length)
      const chat = amoByLead.get(leadId)
      if (!chat || managerChats.has(chat.chatId)) return []
      return [{
        deal_id: id,
        channel: deal.source,
        external_key: key,
        chat_id: chat.chatId,
        lead_id: leadId,
        contact_id: chat.contactId,
      }]
    }
    return []
  })
}

export async function getCampaignsData(): Promise<CampaignsData> {
  const me = await viewer()
  if (!me || !['owner', 'rop'].includes(me.role)) return { campaigns: [], eligibleCount: 0 }
  const admin = createAdminClient()
  const [{ data }, recipients] = await Promise.all([
    admin.from('campaigns').select('*').order('created_at', { ascending: false }).limit(50),
    eligibleRecipients(),
  ])
  return { campaigns: (data ?? []) as CampaignRow[], eligibleCount: recipients.length }
}

const CampaignSchema = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4000),
  scheduledAt: z.string().datetime(),
})

export async function scheduleCampaign(input: unknown): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const me = await viewer()
  if (!me || !['owner', 'rop'].includes(me.role)) return { success: false, error: 'Нет доступа' }
  const parsed = CampaignSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: 'Заполните название, сообщение и время отправки' }
  const scheduledAt = new Date(parsed.data.scheduledAt)
  if (scheduledAt.getTime() < Date.now() - 60_000) return { success: false, error: 'Время отправки уже прошло' }
  const recipients = await eligibleRecipients()
  if (!recipients.length) return { success: false, error: 'Нет доступных клиентов без покупки' }

  const admin = createAdminClient()
  const { data: campaign, error } = await admin.from('campaigns').insert({
    title: parsed.data.title,
    message: parsed.data.message,
    scheduled_at: scheduledAt.toISOString(),
    recipient_count: recipients.length,
    created_by: me.id,
  }).select('id').single()
  if (error || !campaign) return { success: false, error: error?.message ?? 'Не удалось создать рассылку' }
  const { error: recipientError } = await admin.from('campaign_recipients').insert(
    recipients.map((row) => ({ ...row, campaign_id: campaign.id }))
  )
  if (recipientError) {
    await admin.from('campaigns').delete().eq('id', campaign.id)
    return { success: false, error: recipientError.message }
  }
  revalidatePath('/dashboard/campaigns')
  return { success: true, count: recipients.length }
}

export async function cancelCampaign(id: string): Promise<{ success: boolean; error?: string }> {
  const me = await viewer()
  if (!me || !['owner', 'rop'].includes(me.role)) return { success: false, error: 'Нет доступа' }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('campaigns')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
  if (error || !data?.length) return { success: false, error: error?.message ?? 'Рассылку уже нельзя отменить' }
  revalidatePath('/dashboard/campaigns')
  return { success: true }
}
