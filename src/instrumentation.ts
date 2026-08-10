// Фоновые задачи сервера CRM. Next.js вызывает register() один раз при
// старте инстанса (Railway — один инстанс, дублей поллера нет).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startAmoOutgoingPoller } = await import('@/lib/amocrm/outgoing-poller')
    startAmoOutgoingPoller()
  }
}
