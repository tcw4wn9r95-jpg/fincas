import type { AppData } from './types'
import { allProvisionStatuses } from './provisions'
import { allEventStatuses } from './events'

// One number for a job the app couldn't answer before: at the end of the month,
// how much cash do I actually move out of the current account so every provision
// and every upcoming event is on schedule? Provisions know their own pace
// individually; this adds them up for a given month and puts the events that
// have no fund of their own alongside them, so nothing is quietly missing.

const round2 = (n: number) => Math.round(n * 100) / 100

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

export type FundingStatus = 'overdue' | 'due-now' | 'on-track' | 'no-date'

export interface FundingLine {
  id: string
  label: string
  kind: 'provision' | 'event'
  dueDate?: string
  target: number
  funded: number
  /** Still to find before the due date. */
  remaining: number
  /** Months left to spread `remaining` over, counting the plan's own month. */
  monthsLeft: number | null
  /** The share of `remaining` that belongs to this month — what to move. */
  amount: number
  status: FundingStatus
  /** Set when this provision is the fund behind an event. */
  eventLabel?: string
}

export interface FundingPlan {
  month: string
  /** What to move into savings this month. */
  total: number
  /** Everything that still needs money, most urgent first. */
  lines: FundingLine[]
  /** Already fully funded — listed quietly so you can see nothing was skipped. */
  settled: FundingLine[]
  /** Lines that need money but can't be paced because no date was ever set. */
  undated: FundingLine[]
}

function statusFor(month: string, dueMonth: string | undefined): FundingStatus {
  if (!dueMonth) return 'no-date'
  const diff = monthsBetween(month, dueMonth)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'due-now'
  return 'on-track'
}

const RANK: Record<FundingStatus, number> = { overdue: 0, 'due-now': 1, 'on-track': 2, 'no-date': 3 }

/**
 * What to move into savings for `month` (YYYY-MM).
 *
 * Each line spreads what it still needs over the months left before it's due,
 * matching the per-provision pace shown elsewhere in the app. Anything due in
 * `month` — or already overdue — asks for the whole remaining balance, since
 * there is no later month to spread it into.
 *
 * An event that created a provision is represented by that provision alone, so
 * the same trip can never be counted twice; an event without one is added on
 * its own terms, less whatever has already been spent out of pocket.
 */
export function fundingPlan(data: AppData, month: string, today: string): FundingPlan {
  const lines: FundingLine[] = []
  const settled: FundingLine[] = []
  const events = allEventStatuses(data, today)
  const eventByProvision = new Map(
    (data.events ?? []).filter((e) => e.provisionId).map((e) => [e.provisionId!, e.label]),
  )

  for (const p of allProvisionStatuses(data)) {
    const remaining = round2(Math.max(0, p.targetAmount - p.funded))
    const dueMonth = p.dueDate?.slice(0, 7)
    const status = statusFor(month, dueMonth)
    const monthsLeft = dueMonth ? Math.max(1, monthsBetween(month, dueMonth)) : null
    const line: FundingLine = {
      id: p.id,
      label: p.label,
      kind: 'provision',
      dueDate: p.dueDate,
      target: p.targetAmount,
      funded: p.funded,
      remaining,
      monthsLeft,
      amount: remaining > 0 && monthsLeft ? round2(remaining / monthsLeft) : 0,
      status,
      eventLabel: eventByProvision.get(p.id),
    }
    if (remaining <= 0.005) settled.push(line)
    else lines.push(line)
  }

  for (const e of events) {
    // Events with a fund are already represented by that provision above.
    if (e.hasProvision || e.phase === 'past') continue
    const remaining = round2(Math.max(0, e.budget - e.spent))
    const dueMonth = e.startDate.slice(0, 7)
    const status = statusFor(month, dueMonth)
    const monthsLeft = Math.max(1, monthsBetween(month, dueMonth))
    const line: FundingLine = {
      id: e.id,
      label: e.label,
      kind: 'event',
      dueDate: e.startDate,
      target: e.budget,
      funded: round2(Math.min(e.spent, e.budget)),
      remaining,
      monthsLeft,
      amount: remaining > 0 ? round2(remaining / monthsLeft) : 0,
      status,
    }
    if (remaining <= 0.005) settled.push(line)
    else lines.push(line)
  }

  const sort = (a: FundingLine, b: FundingLine) =>
    RANK[a.status] - RANK[b.status] ||
    (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
    b.amount - a.amount

  const undated = lines.filter((l) => l.status === 'no-date').sort(sort)
  const due = lines.filter((l) => l.status !== 'no-date').sort(sort)

  return {
    month,
    total: round2(due.reduce((s, l) => s + l.amount, 0)),
    lines: due,
    settled: settled.sort(sort),
    undated,
  }
}
