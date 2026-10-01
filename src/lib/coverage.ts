// ── Is a month finished? ──────────────────────────────────────────
// A month is only as complete as the least up-to-date account in it. In the
// real data September showed €550 of income and a −€6,076 result, presented
// as final, because the S-Bank statement that carries the salary simply
// hadn't been imported yet. Cut-off is the oldest rule in closing a period:
// nothing is final until every account has been brought up to its last day.

import type { AppData } from './types'
import { currentMonth, todayISO, addMonths } from './format'

export type MonthState =
  /** Every account in use has data through the month's last days. */
  | 'complete'
  /** The month isn't over yet. */
  | 'in-progress'
  /** Over, but at least one account hasn't been imported to its end. */
  | 'provisional'
  /** Nothing imported at all. */
  | 'empty'

export interface MonthCoverage {
  month: string
  state: MonthState
  /** Accounts still owed data for this month, with how far each has got. */
  missing: Array<{ accountId: string; name: string; through?: string }>
}

/** A quiet weekend at month end shouldn't hold a month open. */
const GRACE_DAYS = 3

export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

function minusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * How far each account's data reaches: its latest line, or the closing date of
 * the last statement imported for it, whichever is later — a statement can run
 * a few quiet days past its last transaction.
 */
export function accountReach(data: AppData): Map<string, string> {
  const reach = new Map<string, string>()
  const extend = (id: string, date: string | undefined) => {
    if (date && date > (reach.get(id) ?? '')) reach.set(id, date)
  }
  for (const t of data.transactions) if (t.accountId) extend(t.accountId, t.date)
  for (const b of data.imports ?? []) if (b.accountId) extend(b.accountId, b.periodEnd)
  for (const a of data.accounts) if (a.tracked) extend(a.id, a.asOf)
  return reach
}

/**
 * Months fit to average over: finished, with every account in. A month still
 * waiting on its salary statement would drag every "usual" figure down.
 */
export function settledMonths(data: AppData, today = todayISO()): string[] {
  const months = [...new Set(data.transactions.map((t) => t.month))].sort()
  return months.filter((m) => monthCoverage(data, m, today).state === 'complete')
}

export function monthCoverage(data: AppData, month: string, today = todayISO()): MonthCoverage {
  const has = data.transactions.some((t) => t.month === month)
  if (!has) return { month, state: 'empty', missing: [] }
  if (month >= (today.slice(0, 7) || currentMonth())) return { month, state: 'in-progress', missing: [] }

  // An account counts toward a month once it was in use around it — any line
  // in the month or the two before. A card closed in spring doesn't hold
  // September open, and a new account doesn't reach back to hold March.
  const from = addMonths(month, -2)
  const inUse = new Set(
    data.transactions.filter((t) => t.accountId && t.month >= from && t.month <= month).map((t) => t.accountId!),
  )
  const reach = accountReach(data)
  const needed = minusDays(lastDayOf(month), GRACE_DAYS)
  const missing = data.accounts
    .filter((a) => inUse.has(a.id) && (reach.get(a.id) ?? '') < needed)
    .map((a) => ({ accountId: a.id, name: a.name, through: reach.get(a.id) }))
  return { month, state: missing.length ? 'provisional' : 'complete', missing }
}
