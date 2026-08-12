-- Отдельный флаг от «не рассылать»: номер может быть в стоп-списке рассылок,
-- но ИИ-бот всё ещё отвечает на его входящие сообщения — это разные вещи.
-- block_bot_replies=true — бот вообще ничего не пишет этому номеру, даже
-- если клиент сам написал первым (проверяется в processInboundAmoMessageNow,
-- src/lib/amocrm/bot-reply.ts). История и сделка продолжают вестись.
ALTER TABLE public.campaign_opt_outs
  ADD COLUMN IF NOT EXISTS block_bot_replies BOOLEAN NOT NULL DEFAULT false;
