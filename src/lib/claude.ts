import Anthropic from '@anthropic-ai/sdk'
import type { AppData, ChatMessage, Transaction } from './types'
import { financialSummary, monthReviewText, transactionLedger } from './forecast'
import { CATEGORIES } from './categorize'
import { normDescription, todayISO } from './format'
import {
  allProvisionStatuses,
  emergencyFundStatus,
  transactionAllocations,
  EMERGENCY_FUND_ID,
  EMERGENCY_FUND_LABEL,
} from './provisions'
import { allEventStatuses } from './events'

// The assistant runs entirely from the browser using the user's own
// Anthropic API key (kept on-device). Their financial data is sent only
// to Anthropic's API when they ask a question — never to GitHub or any
// server we control.

function systemPrompt(data: AppData, focusMonth?: string): string {
  const name = data.settings.name?.trim()
  return [
    'You are the CasaresSan Finances assistant, a calm, sharp personal financial advisor embedded in a private budgeting app.',
    name ? `You are speaking with ${name}.` : '',
    'You can see a snapshot of their finances and their individual transactions below. Use the snapshot for totals and trends; use the transaction list when a question needs a specific line — a merchant, a date, a one-off purchase, a pattern across several charges.',
    'Be concise and practical. Lead with the answer, then the reasoning. Use their figures and currency.',
    'When they ask what to do about upcoming expenses, reason about their projected balance, recurring commitments, and goals — and give a concrete recommendation, not a survey of options.',
    'You are an informational assistant, not a licensed financial professional; note big caveats briefly when relevant, without hedging every sentence.',
    'The transaction list only reaches back so far — if something older is asked about and isn\'t there, say it isn\'t in view rather than guessing. If a figure is missing entirely, say so rather than inventing it.',
    'Format every answer in clean, simple markdown: short paragraphs, **bold** for key figures, and a bullet or numbered list when giving multiple points or steps. Never use tables, nested lists, or block quotes — keep the structure flat and easy to scan on a phone.',
    '',
    '--- FINANCIAL SNAPSHOT ---',
    financialSummary(data),
    '--- END SNAPSHOT ---',
    '--- TRANSACTIONS ---',
    transactionLedger(data),
    '--- END TRANSACTIONS ---',
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
    'From the snapshot and transaction ledger, surface 3–6 specific, actionable insights and recommendations as concise markdown bullets.',
    'Ground every point in their real figures and currency. Call out trends (rising/falling categories), where they run over plan, their savings rate, and one or two concrete adjustments with rough euro impact.',
    'The ledger lets you spot things a monthly total can\'t — a specific recurring charge that crept up, a merchant they may not recognise, a category driven by one large purchase rather than a trend. Use it when it sharpens a point, but don\'t just narrate the ledger back to them.',
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
          content: `Here is my financial snapshot:\n\n${financialSummary(data)}\n\nHere are my individual transactions:\n\n${transactionLedger(data)}\n\nGive me your top insights and recommendations.`,
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

// ── Per-transaction advice ────────────────────────────────────────
// "What should I do with this line?" asked from the reconcile screen. The
// answer has to be actionable *in this app*, so the model is told how the
// app's own machinery works — provisions, the emergency fund, events, rules —
// on top of the user's full financial snapshot.

/** How the user has treated lines that look like this one before. */
function similarHistory(data: AppData, tx: Transaction, limit = 8): string[] {
  const key = normDescription(tx.description)
  const out: string[] = []
  for (const t of data.transactions) {
    if (t.id === tx.id || normDescription(t.description) !== key) continue
    const bits = [`${t.date} ${t.description} ${t.amount} → ${t.category}`]
    const allocs = transactionAllocations(t)
    if (allocs.length) {
      bits.push(
        '(' +
          allocs
            .map((a) => {
              const p = data.provisions.find((x) => x.id === a.provisionId)
              const label = a.provisionId === EMERGENCY_FUND_ID ? EMERGENCY_FUND_LABEL : p?.label ?? 'a deleted pot'
              return `${a.role === 'drawdown' ? 'took' : 'put'} ${a.amount} ${a.role === 'drawdown' ? 'from' : 'into'} ${label}`
            })
            .join('; ') +
          ')',
      )
    }
    out.push(bits.join(' '))
    if (out.length >= limit) break
  }
  return out
}

/**
 * Ask what to do with one transaction, streamed into the reconcile card.
 * Deliberately opinionated and short: this is read mid-task, one line among
 * dozens, so a survey of options would be worse than useless.
 */
export async function streamTransactionAdvice(
  data: AppData,
  tx: Transaction,
  handlers: StreamHandlers,
): Promise<void> {
  const apiKey = data.settings.apiKey?.trim()
  if (!apiKey) {
    handlers.onError('Add your Anthropic API key in Settings to ask Claude about a transaction.')
    return
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const { currency } = data.settings
  const provisions = allProvisionStatuses(data).filter((p) => !p.closedAt)
  const emergency = emergencyFundStatus(data)
  const events = allEventStatuses(data, todayISO())
  const history = similarHistory(data, tx)

  const system = [
    'You are a calm, sharp personal financial advisor built into a private budgeting app.',
    'The user is reconciling a bank statement and has stopped on one transaction. Tell them how to treat it.',
    '',
    'HOW THIS APP WORKS — your advice must be expressed in these terms:',
    `- Every transaction gets exactly one category from: ${CATEGORIES.join(', ')}.`,
    '- "Internal" is money moved between the user\'s own accounts; it is excluded from income and spending entirely.',
    '- Provisions are sinking funds for known upcoming bills, each with a target amount and a due date. A transaction can be split across several pots.',
    '- Allocating has a direction: "set aside" adds to a pot, "pull from savings" takes money out of one to cover this spend. Pulling is the right call when the money for this really came out of a pot, whatever the spend was for.',
    '- The emergency fund is the catch-all pot for money not earmarked for any named bill.',
    '- Events (trips, parties) have their own budget and dates; spending inside those dates can be tagged to the event so it is judged against that budget instead of the month.',
    '- Teaching a rule makes every future import with matching wording take a category automatically. Worth suggesting for anything recurring.',
    '- Money put into a pot is reported as savings, not as spending.',
    '',
    'ANSWER FORMAT: at most 4 short markdown bullets, each leading with the action.',
    'Name the exact category, pot, or event to use. Give the one-line reason from their numbers, not generic advice.',
    'If the line is unremarkable, say so in a single bullet — do not manufacture work.',
    'Never use tables or nested lists. Never restate the transaction back to them.',
    '',
    '--- FINANCIAL SNAPSHOT ---',
    financialSummary(data),
    '--- END SNAPSHOT ---',
  ].join('\n')

  const details = [
    `Date: ${tx.date}`,
    `Description: ${tx.description}`,
    `Amount: ${tx.amount} ${currency} (${tx.amount < 0 ? 'money out' : 'money in'})`,
    `Currently filed under: ${tx.category}`,
    provisions.length
      ? 'Provisions available: ' +
        provisions
          .map(
            (p) =>
              `${p.label} [${p.category}] ${p.funded}/${p.targetAmount} funded${p.dueDate ? `, due ${p.dueDate}` : ''}`,
          )
          .join('; ')
      : 'No provisions exist yet.',
    `Emergency fund: ${emergency.balance} saved${emergency.targetAmount ? ` of ${emergency.targetAmount} target` : ''}.`,
    events.length
      ? 'Events: ' +
        events
          .map((e) => `${e.label} (${e.startDate}–${e.endDate}, ${e.spent}/${e.budget} spent)`)
          .join('; ')
      : 'No events planned.',
    history.length
      ? 'How they treated lines with the same wording before:\n' + history.join('\n')
      : 'They have never had a line with this wording before.',
  ].join('\n')

  try {
    const stream = client.messages.stream({
      model: data.settings.model || 'claude-opus-4-8',
      max_tokens: 500,
      system,
      messages: [
        { role: 'user', content: `What should I do with this transaction?\n\n${details}` },
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
    else if (err instanceof Anthropic.RateLimitError) message = 'Rate limited by the API — wait a moment and try again.'
    else if (err instanceof Anthropic.APIError) message = `API error: ${err.message}`
    else if (err instanceof Error) message = err.message
    handlers.onError(message)
  }
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
