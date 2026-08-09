import type { AppData, Provision } from './types'

// Kept free of `forecast.ts` imports (it will import from here) so the two
// modules never form a cycle — hence the small local month-diff helper below
// instead of reusing `forecast.ts`'s private `monthsBetween`.
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface ProvisionStatus {
  id: string
  label: string
  category: string
  targetAmount: number
  dueDate?: string
  /** Accrued so far: contributions minus drawdowns, derived from tagged transactions. */
  funded: number
  contributed: number
  drawn: number
  pct: number
  monthsRemaining: number | null
  suggestedMonthly: number | null
}

/** A provision's accrued balance and progress, derived live from tagged transactions. */
export function provisionStatus(data: AppData, p: Provision): ProvisionStatus {
  let contributed = 0
  let drawn = 0
  for (const t of data.transactions) {
    if (t.provisionId !== p.id) continue
    if (t.provisionRole === 'contribution') contributed += Math.abs(t.amount)
    else if (t.provisionRole === 'drawdown') drawn += Math.abs(t.amount)
  }
  const funded = Math.max(0, round2(contributed - drawn))
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
  }
}

export function allProvisionStatuses(data: AppData): ProvisionStatus[] {
  return data.provisions.map((p) => provisionStatus(data, p))
}

/**
 * This month's drawdown-role transaction totals (absolute), keyed by the
 * owning provision's category — how much of a category's actual spend was
 * already pre-funded, so the money-date view doesn't flag it as a shock.
 */
export function provisionCoveredByCategory(data: AppData, month: string): Record<string, number> {
  const byId = new Map(data.provisions.map((p) => [p.id, p]))
  const covered: Record<string, number> = {}
  for (const t of data.transactions) {
    if (t.month !== month || t.provisionRole !== 'drawdown' || !t.provisionId) continue
    const p = byId.get(t.provisionId)
    if (!p) continue
    covered[p.category] = round2((covered[p.category] ?? 0) + Math.abs(t.amount))
  }
  return covered
}
