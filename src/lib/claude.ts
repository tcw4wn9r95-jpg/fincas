import Anthropic from '@anthropic-ai/sdk'
import type { AppData, ChatMessage, Transaction } from './types'
import { financialSummary, monthReviewText } from './forecast'
import { CATEGORIES } from './categorize'
import { normDescription } from './format'

// The assistant runs entirely from the browser using the user's own
// Anthropic API key (kept on-device). Their financial data is sent only
// to Anthropic's API when they ask a question — never to GitHub or any
// server we control.

function systemPrompt(data: AppData, focusMonth?: string): string {
  const name = data.settings.name?.trim()
  return [
    'You are the CasaresSan Finances assistant, a calm, sharp personal financial advisor embedded in a private budgeting app.',
    name ? `You are speaking with ${name}.` : '',
    'You can see a snapshot of their finances below. Use it to give specific, numbers-grounded answers.',
    'Be concise and practical. Lead with the answer, then the reasoning. Use their figures and currency.',
    'When they ask what to do about upcoming expenses, reason about their projected balance, recurring commitments, and goals — and give a concrete recommendation, not a survey of options.',
    'You are an informational assistant, not a licensed financial professional; note big caveats briefly when relevant, without hedging every sentence.',
    'If a figure is missing from the snapshot, say so rather than inventing it.',
    '',
    '--- FINANCIAL SNAPSHOT ---',
    financialSummary(data),
    '--- END SNAPSHOT ---',
    focusMonth ? '\nThe user is reviewing this specific month — focus on it:' : '',
    focusMonth ? monthReviewText(data, focusMonth) : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface StreamHandlers {
  onText: (delta: string) => void
  onDone: (full: string) => void
  onError: (message: string) => void
}

export function hasApiKey(data: AppData): boolean {
  return Boolean(data.settings.apiKey?.trim())
}

/** Stream tailored recommendations from the user's own numbers into the Insights view. */
export async function streamInsights(data: AppData, handlers: StreamHandlers): Promise<void> {
  const apiKey = data.settings.apiKey?.trim()
  if (!apiKey) {
    handlers.onError('Add your Anthropic API key in Settings to get AI recommendations.')
    return
  }
  const name = data.settings.name?.trim()
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const system = [
    'You are a calm, sharp personal financial advisor writing a short "insights" briefing.',
    name ? `You are advising ${name}.` : '',
    'From the snapshot, surface 3–6 specific, actionable insights and recommendations as concise markdown bullets.',
    'Ground every point in their real figures and currency. Call out trends (rising/falling categories), where they run over plan, their savings rate, and one or two concrete adjustments with rough euro impact.',
    'Be direct and practical — no generic advice, no filler, no restating the whole snapshot. Lead each bullet with the takeaway.',
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const stream = client.messages.stream({
      model: data.settings.model || 'claude-opus-4-8',
      max_tokens: 1200,
      system,
      messages: [
        {
          role: 'user',
          content: `Here is my financial snapshot:\n\n${financialSummary(data)}\n\nGive me your top insights and recommendations.`,
        },
      ],
    })
    stream.on('text', (delta) => handlers.onText(delta))
    const final = await stream.finalMessage()
    handlers.onDone(
      final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    )
  } catch (err) {
    let message = 'Something went wrong talking to Claude.'
    if (err instanceof Anthropic.AuthenticationError) message = 'Your API key was rejected. Check it in Settings.'
    else if (err instanceof Anthropic.APIError) message = `API error: ${err.message}`
    else if (err instanceof Error) message = err.message
    handlers.onError(message)
  }
}

// ── AI categorisation ─────────────────────────────────────────────
// Learns from every category the user has ever assigned: their past choices are
// fed to Claude as examples, so recurring merchants that never match a rule
// exactly (a changing date/reference, a different amount) stop coming in wrong.

/** Distinct past choices (newest / reconciled first), deduped by description. */
function categoryExamples(data: AppData, limit = 200): Transaction[] {
  const sorted = [...data.transactions].sort(
    (a, b) => (b.reconciled ? 1 : 0) - (a.reconciled ? 1 : 0),
  )
  const seen = new Map<string, Transaction>()
  for (const t of sorted) {
    if (t.category === 'Other') continue
    const key = normDescription(t.description)
    if (!seen.has(key)) seen.set(key, t)
  }
  return Array.from(seen.values()).slice(0, limit)
}

/**
 * Ask Claude to categorise transactions, primed with the user's own history so
 * it matches their habits (including amount-dependent ones, e.g. a standing
 * order that's a loan at one amount and an internal transfer at another).
 * Returns a map of transaction id → category (only valid categories).
 */
export async function aiCategorize(
  data: AppData,
  txs: Transaction[],
): Promise<Map<string, string>> {
  const apiKey = data.settings.apiKey?.trim()
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings to use AI categorisation.')
  if (!txs.length) return new Map()

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const examples = categoryExamples(data)
  const exLines = examples.map((e) => `${e.description} | ${e.amount} | ${e.category}`).join('\n')
  const txLines = txs.map((t, i) => `${i} | ${t.description} | ${t.amount}`).join('\n')

  const system = [
    'You categorise bank-statement transactions for a personal-finance app.',
    `Assign each one exactly one category from this list, copied verbatim: ${CATEGORIES.join(', ')}.`,
    "Learn the user's own habits from the history below and prefer their patterns over generic guesses — including when the same wording maps to different categories depending on the amount.",
    'Money coming in (positive) that is salary, a refund, or a transfer in is Income or Transfer, never a spending category. Money the user moves to their own accounts (e.g. top-ups to Revolut) is Internal.',
    examples.length
      ? 'How the user has categorised before (description | amount | category):\n' + exLines
      : 'The user has no history yet — use sensible defaults.',
  ].join('\n\n')

  const userMsg =
    'Categorise each transaction below. Reply with ONLY a JSON array, one object per line index, like ' +
    '[{"i":0,"category":"Food"}], and nothing else.\n\n' +
    'index | description | amount\n' +
    txLines

  const msg = await client.messages.create({
    model: data.settings.model || 'claude-opus-4-8',
    max_tokens: Math.min(4096, 200 + txs.length * 16),
    system,
    messages: [{ role: 'user', content: userMsg }],
  })

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error('The model returned an unexpected response.')
  let parsed: Array<{ i: number; category: string }>
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('Could not read the model’s response.')
  }

  const valid = new Set<string>(CATEGORIES)
  const out = new Map<string, string>()
  for (const { i, category } of parsed) {
    const t = txs[i]
    if (t && valid.has(category)) out.set(t.id, category)
  }
  return out
}

export async function askClaude(
  data: AppData,
  history: ChatMessage[],
  handlers: StreamHandlers,
  focusMonth?: string,
): Promise<void> {
  const apiKey = data.settings.apiKey?.trim()
  if (!apiKey) {
    handlers.onError('Add your Anthropic API key in Settings to chat with the assistant.')
    return
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  try {
    const stream = client.messages.stream({
      model: data.settings.model || 'claude-opus-4-8',
      max_tokens: 1600,
      system: systemPrompt(data, focusMonth),
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    })

    stream.on('text', (delta) => handlers.onText(delta))
    const final = await stream.finalMessage()
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    handlers.onDone(text)
  } catch (err) {
    let message = 'Something went wrong talking to Claude.'
    if (err instanceof Anthropic.AuthenticationError) {
      message = 'Your API key was rejected. Check it in Settings.'
    } else if (err instanceof Anthropic.RateLimitError) {
      message = 'Rate limited by the API — wait a moment and try again.'
    } else if (err instanceof Anthropic.APIError) {
      message = `API error: ${err.message}`
    } else if (err instanceof Error) {
      message = err.message
    }
    handlers.onError(message)
  }
}
