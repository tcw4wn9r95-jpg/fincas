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

/** A transaction matching the provision's own category is the real bill (drawdown); anything else is money set aside for it (contribution). */
export function provisionRoleFor(category: string, provision: Pick<Provision, 'category'>): 'contribution' | 'drawdown' {
  return category === provision.category ? 'drawdown' : 'contribution'
}

/**
 * The amount to pre-fill when allocating a transaction to a provision. A
 * drawdown (the real bill) defaults to the whole transaction — that's usually
 * the exact bill. A contribution defaults to the provision's suggested monthly
 * set-aside (target remaining ÷ months until due), since the transfer itself
 * rarely matches that figure exactly. Either way it's capped by `available`
 * (default: the transaction's full amount) so a suggestion can never overspend
 * what's left to allocate.
 */
export function suggestProvisionAmount(
  t: Transaction,
  status: ProvisionStatus,
  available = Math.abs(t.amount),
): number {
  const role = provisionRoleFor(t.category, status)
  const wanted =
    role === 'contribution' && status.suggestedMonthly && status.suggestedMonthly > 0
      ? status.suggestedMonthly
      : Math.abs(t.amount)
  return round2(Math.max(0, Math.min(wanted, available)))
}

/**
 * Drawdown-role transaction totals across a set of months (absolute), keyed
 * by the owning provision's category — how much of a category's actual
 * spend was already pre-funded, so the money-date view and the Sankey don't
 * flag/draw it as fresh, unplanned spending.
 */
export function provisionCoveredByCategoryRange(data: AppData, months: string[]): Record<string, number> {
  const monthSet = new Set(months)
  const byId = new Map(data.provisions.map((p) => [p.id, p]))
  const covered: Record<string, number> = {}
  for (const t of data.transactions) {
    if (!monthSet.has(t.month)) continue
    for (const a of transactionAllocations(t)) {
      if (a.role !== 'drawdown') continue
      const p = byId.get(a.provisionId)
      if (!p) continue
      covered[p.category] = round2((covered[p.category] ?? 0) + a.amount)
    }
  }
  return covered
}

/** Single-month convenience wrapper — see `provisionCoveredByCategoryRange`. */
export function provisionCoveredByCategory(data: AppData, month: string): Record<string, number> {
  return provisionCoveredByCategoryRange(data, [month])
}
