'use server'

// Аварийный выключатель бота amoCRM (WhatsApp-канал). Флаг
// integrations.amoCRM.is_active читается на каждое входящее сообщение
// (src/lib/amocrm/bot-reply.ts): выключен — бот молчит мгновенно, история
// пишется и этапы сделок двигаются дальше.

import { createAdminClient } from '@/lib/supabase/admin'

export async function getAmoBotEnabled(): Promise<
  { success: true; enabled: boolean } | { success: false; error: string }
> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('integrations').select('is_active').eq('name', 'amoCRM').maybeSingle()
  if (error) return { success: false, error: error.message }
  return { success: true, enabled: Boolean((data as { is_active?: boolean } | null)?.is_active) }
}

export async function setAmoBotEnabled(
  enabled: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('integrations')
    .update({ is_active: enabled, updated_at: new Date().toISOString() })
    .eq('name', 'amoCRM')
  if (error) return { success: false, error: error.message }
  return { success: true }
}
