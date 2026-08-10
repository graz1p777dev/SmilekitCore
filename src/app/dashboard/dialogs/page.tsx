import { SmilekitDialogsClient } from '@/components/bot/SmilekitDialogsClient'

// Переписка живёт в SQLite бота (Railway smilekit-bot) — страница только
// рендерит клиент, данные ходят через server actions с внутренним токеном.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Диалоги — Smilekit' }

export default function DialogsPage() {
  return <SmilekitDialogsClient />
}
