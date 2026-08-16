// Фоновые задачи сервера CRM. Next.js вызывает register() один раз при
// старте инстанса (Railway — один инстанс, дублей поллера нет).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // WhatsApp-канал переехал с amoCRM/WhatCRM на Green API. Пока
    // AMOCRM_CHANNEL_ENABLED !== 'true', фоновые задачи amoCRM не стартуют:
    // иначе на одно входящее сообщение отвечали бы оба канала сразу
    // (один и тот же номер), и клиент получал бы дубли.
    if (process.env.AMOCRM_CHANNEL_ENABLED === 'true') {
      const { startAmoOutgoingPoller } = await import('@/lib/amocrm/outgoing-poller')
      startAmoOutgoingPoller()
      const { replayRecentUnansweredAmoMessages } = await import('@/lib/amocrm/bot-reply')
      void replayRecentUnansweredAmoMessages().catch((error) =>
        console.error('amocrm unanswered replay failed', error)
      )
    }
    const { startCampaignScheduler } = await import('@/lib/campaigns/scheduler')
    startCampaignScheduler()
    // Импорт манифеста регистрирует интеграции — планировщикам нужен
    // зарегистрированный канал, чтобы отправлять через ядро.
    const { startFollowupScheduler } = await import('@/integrations/greenapi')
    await import('@/integrations')
    startFollowupScheduler()

    // Переменные, заданные на сайте, попадают в синхронный кэш до первого
    // сообщения — иначе страницы состояния на старте покажут «не настроено».
    const { vars } = await import('@/core/variables')
    void vars.warmup().catch((error) => console.error('[core] прогрев переменных не удался', error))

    // Отложенные шаги сценариев с канвы («Подождать N минут»).
    const { startFlowScheduler } = await import('@/core/flow/jobs')
    startFlowScheduler()
  }
}
