import type { AppData, Provision, ProvisionAllocation, Transaction } from './types'

// Kept free of `forecast.ts` imports (it will import from here) so the two
// modules never form a cycle — hence the small local month-diff helper below
// instead of reusing `forecast.ts`'s private `monthsBetween`.
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The single way to read a transaction's provision splits. Data saved before
 * splitting existed carries one link in the legacy `provisionId` fields; it's
 * surfaced here as a one-entry list so every caller sees the same shape and
 * nothing needs migrating on load.
 */
export function transactionAllocations(t: Transaction): ProvisionAllocation[] {
  if (t.provisionAllocations) return t.provisionAllocations.filter((a) => a.provisionId && a.amount > 0)
  if (!t.provisionId) return []
  return [
    {
      provisionId: t.provisionId,
      amount: t.provisionAmount ?? Math.abs(t.amount),
      role: t.provisionRole ?? 'contribution',
    },
  ]
}

/** How much of a transaction is already spoken for across all its buckets. */
export function allocatedTotal(t: Transaction): number {
  return round2(transactionAllocations(t).reduce((s, a) => s + a.amount, 0))
}

/** What's still free to assign — the "500 left" of a €1,000 transfer split €500 to taxes. */
export function unallocatedAmount(t: Transaction): number {
  return round2(Math.max(0, Math.abs(t.amount) - allocatedTotal(t)))
}

/**
 * Drop the matching allocations from a transaction, in place. Legacy
 * single-link data is normalised through `transactionAllocations` first, so a
 * pre-split transaction can't quietly survive its provision being deleted or
 * recategorised.
 */
export function dropAllocations(
  t: Transaction,
  predicate: (a: ProvisionAllocation) => boolean,
): void {
  const current = transactionAllocations(t)
  const kept = current.filter((a) => !predicate(a))
  if (kept.length === current.length) return
  t.provisionAllocations = kept.length ? kept : undefined
  t.provisionId = undefined
  t.provisionRole = undefined
  t.provisionAmount = undefined
}

/**
 * The emergency fund is addressed like a provision in the allocation list,
 * under this reserved id, so one transaction can be split between named
 * provisions and the catch-all pot without a second mechanism. It is
 * deliberately *not* a `Provision`: it has no category and no due date, so it
 * never appears in the provisions list or the category-coverage maps by name.
 */
export const EMERGENCY_FUND_ID = 'emergency-fund'
export const EMERGENCY_FUND_LABEL = 'Emergency fund'

export interface EmergencyFundStatus {
  targetAmount: number
  /** Paid in minus taken out, floored at 0 for the progress bar. */
  balance: number
  contributed: number
  drawn: number
  pct: number
  /** Taken out more than was ever paid in — the difference came from elsewhere. */
  overdrawn: number
}

/** The emergency fund's balance, derived live from tagged transactions. */
export function emergencyFundStatus(data: AppData): EmergencyFundStatus {
  let contributed = 0
  let drawn = 0
  for (const t of data.transactions) {
    for (const a of transactionAllocations(t)) {
      if (a.provisionId !== EMERGENCY_FUND_ID) continue
      if (a.role === 'drawdown') drawn += a.amount
      else contributed += a.amount
    }
  }
  const net = round2(contributed - drawn)
  const targetAmount = data.emergencyFund?.targetAmount ?? 0
  const balance = Math.max(0, net)
  return {
    targetAmount,
    balance,
    contributed: round2(contributed),
    drawn: round2(drawn),
    pct: targetAmount > 0 ? Math.min(100, Math.round((balance / targetAmount) * 100)) : 0,
    overdrawn: Math.max(0, -net),
  }
}

export interface ProvisionStatus {
  id: string
  label: string
  category: string
  targetAmount: number
  dueDate?: string
  /** Accrued so far: contributions minus drawdowns, floored at 0 for the progress bar. */
  funded: number
  contributed: number
  drawn: number
  pct: number
  monthsRemaining: number | null
  suggestedMonthly: number | null
  /** Drawn more than was ever contributed — the shortfall came from somewhere else, not this pot. */
  overdrawn: number
}

/** A provision's accrued balance and progress, derived live from tagged transactions. */
export function provisionStatus(data: AppData, p: Provision): ProvisionStatus {
  let contributed = 0
  let drawn = 0
  for (const t of data.transactions) {
    for (const a of transactionAllocations(t)) {
      if (a.provisionId !== p.id) continue
      if (a.role === 'drawdown') drawn += a.amount
      else contributed += a.amount
    }
  }
  const balance = round2(contributed - drawn)
  const funded = Math.max(0, balance)
  const overdrawn = Math.max(0, -balance)
  const pct = p.targetAmount > 0 ? Math.min(100, Math.round((funded / p.targetAmount) * 100)) : 0

  let monthsRemaining: number | null = null
  let suggestedMonthly: number | null = null
  if (p.dueDate) {
    const now = new Date()
    const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    monthsRemaining = Math.max(0, monthsBetween(nowMonth, p.dueDate.slice(0, 7)))
    const remaining = Math.max(0, p.targetAmount - funded)
    suggestedMonthly = round2(remaining / Math.max(1, monthsRemaining))
  }

  return {
    id: p.id,
    label: p.label,
    category: p.category,
    targetAmount: p.targetAmount,
    dueDate: p.dueDate,
    funded,
    contributed: round2(contributed),
    drawn: round2(drawn),
    pct,
    monthsRemaining,
    suggestedMonthly,
    overdrawn,
  }
}

export function allProvisionStatuses(data: AppData): ProvisionStatus[] {
  return data.provisions.map((p) => provisionStatus(data, p))
}

/**
 * The opening guess at which way a transaction moves money: one in the
 * provision's own category is the bill itself (drawdown), anything else is
 * assumed to be money set aside (contribution). Only a starting point — the
 * allocation pop-up lets the direction be set outright, because savings can
 * pay for something filed under any category at all.
 */
export function provisionRoleFor(category: string, provision: Pick<Provision, 'category'>): 'contribution' | 'drawdown' {
  return category === provision.category ? 'drawdown' : 'contribution'
}

/**
 * The amount to pre-fill when allocating a transaction to a provision.
 *
 * Taking money out defaults to the whole transaction — you're covering this
 * spend from the pot. Putting money in defaults to the provision's suggested
 * monthly set-aside (target remaining ÷ months until due), since the transfer
 * itself rarely matches that figure exactly. Either way it's capped by
 * `available` (default: the transaction's full amount) so a suggestion can
 * never overspend what's left to allocate.
 *
 * `role` defaults to the guess from the categories, for callers that have no
 * explicit direction to hand.
 */
export function suggestProvisionAmount(
  t: Transaction,
  status: ProvisionStatus,
  available = Math.abs(t.amount),
  role: 'contribution' | 'drawdown' = provisionRoleFor(t.category, status),
): number {
  const wanted =
    role === 'contribution' && status.suggestedMonthly && status.suggestedMonthly > 0
      ? status.suggestedMonthly
      : Math.abs(t.amount)
  return round2(Math.max(0, Math.min(wanted, available)))
}

/**
 * Drawdown totals across a set of months (absolute), keyed by the category the
 * money was actually spent in — how much of that category's spend was already
 * pre-funded, so the money-date view and the Sankey don't flag or draw it as
 * fresh, unplanned spending.
 *
 * Keyed by the transaction's own category rather than the pot's: savings pulled
 * to cover a spend can land under any category, and what got pre-funded is the
 * thing that was bought.
 */
export function provisionCoveredByCategoryRange(data: AppData, months: string[]): Record<string, number> {
  const monthSet = new Set(months)
  const byId = new Map(data.provisions.map((p) => [p.id, p]))
  const covered: Record<string, number> = {}
  for (const t of data.transactions) {
    if (!monthSet.has(t.month)) continue
    for (const a of transactionAllocations(t)) {
      if (a.role !== 'drawdown') continue
      // Allocations to a pot that no longer exists shouldn't count for anything.
      if (a.provisionId !== EMERGENCY_FUND_ID && !byId.has(a.provisionId)) continue
      covered[t.category] = round2((covered[t.category] ?? 0) + a.amount)
    }
  }
  return covered
}

/** Single-month convenience wrapper — see `provisionCoveredByCategoryRange`. */
export function provisionCoveredByCategory(data: AppData, month: string): Record<string, number> {
  return provisionCoveredByCategoryRange(data, [month])
}
