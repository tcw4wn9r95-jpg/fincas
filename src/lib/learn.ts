// ── Learning from what you reconciled ─────────────────────────────
// Every line you reconcile is a decision: this merchant, at about this amount,
// is this category. The AI categoriser used to see 200 of your past lines,
// deduplicated by their exact wording — and bank wording carries a date or a
// reference on almost every line ("DEBIT TPV AUCHAN 03.07", "AMAZON*
// H58WD0OO5"), so each was its own one-off example, recurring merchants
// crowded out, and lines nobody had confirmed mixed in with ones you had.
//
// Here lines are grouped by merchant, references and dates stripped, and only
// reconciled lines count. A merchant you have always filed the same way is
// filed that way again without asking anyone; the rest go to the model with
// your own history for that merchant and its nearest neighbours.

import type { AppData, Transaction } from './types'

/** Banking boilerplate that says how money moved, not who it went to. */
const PREFIX =
  /^(?:direct debit|standing order in favour of|instant credit transfer(?: s-net\s*:\s*[\d-]+)?(?: in favour of| from)?|credit transfer(?: in favour of| from)?|debit tpv|debit|card payment to|payment from|payment to|transfer from|transfer to|to [a-z]{3}|from [a-z]{3})\s+/i

/**
 * The merchant a line is about, stable across months: lower-cased, banking
 * prefix dropped, and every token carrying a digit removed — the dates,
 * card numbers and order references that make each line's wording unique.
 */
export function merchantKey(description: string): string {
  const words = description
    .toLowerCase()
    .replace(PREFIX, '')
    .replace(/[^a-z0-9à-ÿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/\d/.test(w))
  return words.slice(0, 4).join(' ')
}

export interface Precedent {
  category: string
  amount: number
  date: string
  description: string
}

/** Reconciled decisions by merchant. Unconfirmed guesses never teach anything. */
export function reconciledHistory(data: AppData): Map<string, Precedent[]> {
  const out = new Map<string, Precedent[]>()
  for (const t of data.transactions) {
    if (!t.reconciled || t.category === 'Other') continue
    const key = merchantKey(t.description)
    if (!key) continue
    const list = out.get(key) ?? []
    list.push({ category: t.category, amount: t.amount, date: t.date, description: t.description })
    out.set(key, list)
  }
  return out
}

export interface Recall {
  category: string
  /** `sure`: safe to apply without asking. `likely`: a strong hint, worth confirming. */
  confidence: 'sure' | 'likely'
  /** How many reconciled lines back it. */
  support: number
}

/**
 * What you have done with this merchant before. Same direction of money only —
 * a refund from a shop isn't a purchase. One category every time is sure once
 * it has happened twice, or once at the very same amount. Where the same
 * merchant has gone to different categories (a standing order that is the
 * loan at one amount and savings at another), the nearest amount decides, and
 * is only sure when it is a near-exact match.
 */
export function recall(history: Map<string, Precedent[]>, t: Pick<Transaction, 'description' | 'amount'>): Recall | null {
  const past = (history.get(merchantKey(t.description)) ?? []).filter((p) => Math.sign(p.amount) === Math.sign(t.amount))
  if (!past.length) return null
  const categories = new Set(past.map((p) => p.category))
  if (categories.size === 1) {
    const sameAmount = past.some((p) => Math.abs(p.amount - t.amount) < 0.005)
    return {
      category: past[0].category,
      confidence: past.length >= 2 || sameAmount ? 'sure' : 'likely',
      support: past.length,
    }
  }
  const nearest = past.reduce((best, p) =>
    Math.abs(p.amount - t.amount) < Math.abs(best.amount - t.amount) ? p : best,
  )
  const close = Math.abs(nearest.amount - t.amount) <= Math.max(0.01, Math.abs(t.amount) * 0.02)
  return {
    category: nearest.category,
    confidence: close ? 'sure' : 'likely',
    support: past.filter((p) => p.category === nearest.category).length,
  }
}

/**
 * Reconciled lines from merchants that look like this one — sharing a word of
 * the merchant name — for the model to reason from when there is no exact
 * precedent. Most recent first, one per merchant and category.
 */
export function similarPrecedents(
  history: Map<string, Precedent[]>,
  t: Pick<Transaction, 'description'>,
  limit = 6,
): Precedent[] {
  const words = new Set(merchantKey(t.description).split(' ').filter((w) => w.length >= 4))
  if (!words.size) return []
  const scored: Array<{ p: Precedent; score: number }> = []
  for (const [key, list] of history) {
    const score = key.split(' ').filter((w) => words.has(w)).length
    if (!score) continue
    const seen = new Set<string>()
    for (const p of [...list].sort((a, b) => b.date.localeCompare(a.date))) {
      if (seen.has(p.category)) continue
      seen.add(p.category)
      scored.push({ p, score })
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || b.p.date.localeCompare(a.p.date))
    .slice(0, limit)
    .map((x) => x.p)
}

/**
 * The household's habits in one table for the model: each merchant once, with
 * how often each category was chosen and a typical amount. Most-used first,
 * so the merchants that recur most are the ones never cut for length.
 */
export function habitsTable(history: Map<string, Precedent[]>, limit = 400): string[] {
  const rows: Array<{ line: string; n: number }> = []
  for (const [key, list] of history) {
    const byCat = new Map<string, Precedent[]>()
    for (const p of list) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p])
    const parts = [...byCat.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([cat, ps]) => {
        const amounts = ps.map((p) => p.amount).sort((a, b) => a - b)
        const mid = amounts[Math.floor(amounts.length / 2)]
        return `${cat} ×${ps.length} (≈${mid})`
      })
    rows.push({ line: `${key} → ${parts.join('; ')}`, n: list.length })
  }
  return rows
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((r) => r.line)
}
