import { sendAmoChatMessage } from '@/lib/amocrm/chat'
import { smilekitBotFetch } from '@/lib/smilekit-bot-api'
import { createAdminClient } from '@/lib/supabase/admin'

const POLL_INTERVAL_MS = 30_000
const SEND_INTERVAL_MS = 1_000
let started = false

type Campaign = { id: string; message: string }
type Recipient = {
  id: number
  channel: 'telegram' | 'whatsapp' | 'instagram'
  chat_id: string
  lead_id: string | null
  contact_id: string | null
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function recoverInterruptedCampaigns() {
  const admin = createAdminClient()
  const { data: running } = await admin.from('campaigns').select('id').eq('status', 'running')
  const ids = (running ?? []).map((row) => row.id)
  if (!ids.length) return
  await admin
    .from('campaign_recipients')
    .update({ status: 'failed', error: 'Отправка прервана перезапуском сервиса' })
    .in('campaign_id', ids)
    .eq('status', 'sending')
  await admin.from('campaigns').update({ status: 'scheduled' }).in('id', ids)
}

async function send(recipient: Recipient, campaign: Campaign) {
  if (recipient.channel === 'telegram') {
    const result = await smilekitBotFetch<{ ok: true }>(
      `/internal/chats/${encodeURIComponent(recipient.chat_id)}/broadcast`,
      { method: 'POST', body: { text: campaign.message } }
    )
    if (!result.ok) throw new Error(result.error)
    return
  }
  // Записываем ДО отправки как своё сообщение: иначе исходящее эхо из вебхука
  // amoCRM не опознаётся (registerOutgoingAmoMessage ищет свежую строку с
  // sender='bot' и тем же текстом) и рассылка выглядит как «менеджер вступил
  // в диалог» — бот после этого замолкает в чате навсегда, а чат выпадает из
  // аудитории следующих рассылок.
  const admin = createAdminClient()
  await admin.from('amocrm_messages').upsert({
    amo_message_id: `campaign:${campaign.id}:${recipient.id}`,
    chat_id: recipient.chat_id,
    lead_id: recipient.lead_id,
    contact_id: recipient.contact_id,
    direction: 'out',
    sender: 'bot',
    text: campaign.message,
  }, { onConflict: 'amo_message_id', ignoreDuplicates: true })
  await sendAmoChatMessage({
    chatId: recipient.chat_id,
    leadId: recipient.lead_id,
    contactId: recipient.contact_id,
    text: campaign.message,
  })
}

async function finishCampaign(campaignId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('campaign_recipients')
    .select('status')
    .eq('campaign_id', campaignId)
  const sent = (data ?? []).filter((row) => row.status === 'sent').length
  const failed = (data ?? []).filter((row) => ['failed', 'skipped'].includes(row.status)).length
  await admin.from('campaigns').update({
    status: sent > 0 || failed === 0 ? 'completed' : 'failed',
    sent_count: sent,
    failed_count: failed,
    completed_at: new Date().toISOString(),
  }).eq('id', campaignId)
}

async function processCampaign(campaign: Campaign) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('campaign_recipients')
    .select('id, channel, chat_id, lead_id, contact_id')
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending')
    .order('id')

  for (const recipient of (data ?? []) as Recipient[]) {
    const { data: claimed } = await admin
      .from('campaign_recipients')
      .update({ status: 'sending', error: null })
      .eq('id', recipient.id)
      .eq('status', 'pending')
      .select('id')
    if (!claimed?.length) continue
    try {
      await send(recipient, campaign)
      await admin.from('campaign_recipients').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).eq('id', recipient.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка отправки'
      await admin.from('campaign_recipients').update({
        status: 'failed',
        error: message.slice(0, 500),
      }).eq('id', recipient.id)
    }
    await delay(SEND_INTERVAL_MS)
  }
  await finishCampaign(campaign.id)
}

async function poll() {
  const admin = createAdminClient()
  const { data } = await admin
    .from('campaigns')
    .select('id, message')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at')
    .limit(1)
    .maybeSingle()
  if (!data) return
  const { data: claimed } = await admin
    .from('campaigns')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', data.id)
    .eq('status', 'scheduled')
    .select('id, message')
    .maybeSingle()
  if (claimed) await processCampaign(claimed as Campaign)
}

export function startCampaignScheduler() {
  if (started) return
  started = true
  void recoverInterruptedCampaigns()
    .then(poll)
    .catch((error) => console.error('campaign scheduler recovery failed', error))
  const timer = setInterval(() => {
    void poll().catch((error) => console.error('campaign scheduler failed', error))
  }, POLL_INTERVAL_MS)
  timer.unref?.()
}
