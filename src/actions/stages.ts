'use server'

// Настройка воронки: порядок и описания этапов — как в amoCRM, прямо с доски.
//
// Права: RLS на deal_stages пускает менять этапы только владельцу, здесь та же
// проверка ради понятной ошибки («Настраивать воронку может владелец» вместо
// молчаливого нуля обновлённых строк).

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type StageActionResult = { success: true } | { success: false; error: string }

async function requireOwner(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>> } | null> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data } = await supabase
    .from('employees')
    .select('role')
    .eq('user_id', session.user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if ((data as { role?: string } | null)?.role !== 'owner') return null
  return { supabase }
}

/**
 * Новый порядок этапов: массив id в том порядке, как колонки стоят на доске.
 * sort_order переписывается с шагом 10 — остаётся место вставить этап между
 * соседними без пересчёта всей воронки.
 */
export async function reorderStages(orderedIds: string[]): Promise<StageActionResult> {
  const ctx = await requireOwner()
  if (!ctx) return { success: false, error: 'Настраивать воронку может владелец' }
  if (!orderedIds.length || orderedIds.length > 50) return { success: false, error: 'Некорректный порядок' }

  for (let index = 0; index < orderedIds.length; index++) {
    const { error } = await ctx.supabase
      .from('deal_stages')
      .update({ sort_order: (index + 1) * 10 })
      .eq('id', orderedIds[index])
    if (error) return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/deals')
  return { success: true }
}

/** Описание этапа: что это за шаг и когда сделка сюда попадает. */
export async function updateStageDescription(stageId: string, description: string): Promise<StageActionResult> {
  const ctx = await requireOwner()
  if (!ctx) return { success: false, error: 'Настраивать воронку может владелец' }

  const value = description.trim().slice(0, 500) || null
  const { error } = await ctx.supabase.from('deal_stages').update({ description: value }).eq('id', stageId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/deals')
  return { success: true }
}

/** Переименование этапа — тоже с доски, без похода в БД. */
export async function renameStage(stageId: string, name: string): Promise<StageActionResult> {
  const ctx = await requireOwner()
  if (!ctx) return { success: false, error: 'Настраивать воронку может владелец' }

  const value = name.trim()
  if (!value || value.length > 100) return { success: false, error: 'Название: от 1 до 100 символов' }
  const { error } = await ctx.supabase.from('deal_stages').update({ name: value }).eq('id', stageId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/deals')
  return { success: true }
}
