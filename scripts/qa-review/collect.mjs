// Запускается на самом Railway-инстансе smilekit-crm (есть все секреты).
// 1. Находит пары "клиент спросил -> менеджер (живой человек) ответил текстом"
// 2. Прогоняет тот же вопрос через бота (/internal/lab) — получает ответ бота
// 3. Судья (DeepSeek) сравнивает ответ бота с реальным ответом менеджера
// Печатает JSON-массив в stdout.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BOT_API = process.env.SMILEKIT_BOT_API_URL?.replace(/\/$/, '')
const BOT_TOKEN = process.env.SMILEKIT_BOT_INTERNAL_TOKEN
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY

const MAX_PAIRS = 25
const LOOKBACK_DAYS = 21
const MARKER_RE = /^\[.*\]$/

async function botReply(message, history) {
  const res = await fetch(`${BOT_API}/internal/lab`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': BOT_TOKEN },
    body: JSON.stringify({ message, history }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return (data.reply || '').trim() || null
}

async function judge(question, managerAnswer, botAnswer) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      temperature: 0,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content:
            'Ты — строгий QA-эксперт по продажам SmileKit (отбеливающие полоски). ' +
            'Тебе дают вопрос клиента, реальный ответ живого менеджера и ответ ИИ-бота на тот же вопрос. ' +
            'Сравни их. Ответь СТРОГО в формате JSON без markdown: ' +
            '{"verdict":"match"|"bot_worse"|"bot_better"|"different_but_ok","reason":"1-2 предложения по-русски"}',
        },
        {
          role: 'user',
          content: `Вопрос клиента: ${question}\n\nОтвет менеджера (человек): ${managerAnswer}\n\nОтвет бота: ${botAnswer}`,
        },
      ],
    }),
  })
  if (!res.ok) return { verdict: 'error', reason: `judge HTTP ${res.status}` }
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content?.trim() || '{}'
  try {
    return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    return { verdict: 'error', reason: 'judge: bad JSON: ' + raw.slice(0, 200) }
  }
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString()
  const { data: rows, error } = await supabase
    .from('amocrm_messages')
    .select('chat_id, sender, text, created_at')
    .gte('created_at', since)
    .order('chat_id', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(20000)
  if (error) throw new Error(error.message)

  const byChat = new Map()
  for (const row of rows) {
    // @g.us — групповой чат (например, группа доставки), не переписка с
    // клиентом: ответы там не про товар и портят выборку.
    if (row.chat_id.endsWith('@g.us')) continue
    if (!byChat.has(row.chat_id)) byChat.set(row.chat_id, [])
    byChat.get(row.chat_id).push(row)
  }

  const pairs = []
  for (const [chatId, msgs] of byChat) {
    for (let i = 0; i < msgs.length - 1; i++) {
      const q = msgs[i]
      const a = msgs[i + 1]
      if (q.sender !== 'client' || a.sender !== 'operator') continue
      const questionText = (q.text || '').split('\n[media]')[0].trim()
      const answerText = (a.text || '').trim()
      if (!questionText || !answerText) continue
      if (MARKER_RE.test(answerText) || answerText.length < 5) continue
      if (MARKER_RE.test(questionText)) continue
      const history = msgs.slice(Math.max(0, i - 10), i).map((m) => ({
        role: m.sender === 'client' ? 'user' : 'assistant',
        content: (m.text || '').split('\n[media]')[0],
      }))
      pairs.push({ chatId, questionText, answerText, history })
    }
  }

  // Свежие пары в приоритете.
  pairs.reverse()
  const selected = pairs.slice(0, MAX_PAIRS)

  const results = []
  for (const pair of selected) {
    const botAnswer = await botReply(pair.questionText, pair.history)
    if (!botAnswer) continue
    const verdict = await judge(pair.questionText, pair.answerText, botAnswer)
    results.push({
      chatId: pair.chatId,
      question: pair.questionText,
      managerAnswer: pair.answerText,
      botAnswer,
      verdict: verdict.verdict,
      reason: verdict.reason,
    })
  }

  console.log(JSON.stringify(results))
}

main().catch((error) => {
  console.error('QA_COLLECT_FAILED', error.message)
  process.exit(1)
})
