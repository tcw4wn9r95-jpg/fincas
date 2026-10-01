// ── Data health ───────────────────────────────────────────────────
// Every figure in this app is derived, which keeps it internally consistent and
// says nothing about whether the inputs were right. These are the checks an
// auditor would run before trusting a month: is any record stored twice, does
// every statement agree with its own balance, does money moved between your
// own accounts arrive where it left, can a card really be in credit. Each one
// was missing when a real error got through — a July counted twice, a card
// €52k in credit, an emergency fund €7,000 richer than its transfers.

import type { AppData, Transaction } from './types'
import { NON_CASHFLOW, isIncomeCategory } from './categorize'

const round2 = (n: number) => Math.round(n * 100) / 100

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** The household's ordinary monthly income: the median, so one bonus can't move it. */
export function typicalMonthlyIncome(data: AppData): number {
  const byMonth: Record<string, number> = {}
  for (const t of data.transactions) {
    if (t.oneOff || !isIncomeCategory(t.category)) continue
    byMonth[t.month] = (byMonth[t.month] ?? 0) + t.amount
  }
  return round2(median(Object.values(byMonth).filter((v) => v > 0)))
}

/**
 * A test for lines worth asking "was this a one-off?" about — measured against
 * the household's own usual income, because a fixed threshold is wrong for
 * every household but one. A receipt filed as income is asked about once it is
 * half again a usual month; a refund filed under a cost, once it is a quarter of
 * one — last year's tax coming back, not a pharmacy reimbursement.
 */
export function oneOffSpotter(data: AppData): (t: Transaction) => boolean {
  const usual = typicalMonthlyIncome(data)
  const incomeBar = Math.max(1000, usual * 1.5)
  const refundBar = Math.max(500, usual * 0.25)
  return (t) => {
    if (t.oneOff || t.amount <= 0 || NON_CASHFLOW.has(t.category)) return false
    return t.amount >= (isIncomeCategory(t.category) ? incomeBar : refundBar)
  }
}
