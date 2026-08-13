import type { AppData, Transaction } from './types'
import { allProvisionStatuses, emergencyFundStatus, EMERGENCY_FUND_ID } from './provisions'
import { allEventStatuses } from './events'
import { NON_CASHFLOW } from './categorize'
import { uid } from './format'

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
  /** Underfunded, but the date has passed — they no longer ask for anything. */
  lapsed: FundingLine[]
}

const RANK: Record<FundingStatus, number> = { overdue: 0, 'due-now': 1, 'on-track': 2, 'no-date': 3 }

/**
 * What to move into savings for `month` (YYYY-MM).
 *
 * Each line spreads what it still needs over the months left before it's due,
 * matching the per-provision pace shown elsewhere in the app. Anything due in
 * `month` asks for the whole remaining balance, since there is no later month
 * to spread it into.
 *
 * Once a date has passed, the line stops asking for money entirely: that bill
 * has either landed or it hasn't, and either way a transfer now doesn't change
 * it — a running catch-up tab would just inflate every future month with money
 * that is no longer going anywhere. Passed is judged against today or the start
 * of `month`, whichever is later, so a provision due on the 5th has lapsed by
 * the 20th even while you're still looking at the current month.
 *
 * An event that created a provision is represented by that provision alone, so
 * the same trip can never be counted twice; an event without one is added on
 * its own terms, less whatever has already been spent out of pocket.
 */
export function fundingPlan(data: AppData, month: string, today: string): FundingPlan {
  const lines: FundingLine[] = []
  const settled: FundingLine[] = []
  // The moment the transfer would actually be made.
  const monthStart = `${month}-01`
  const asOf = today > monthStart ? today : monthStart
  const statusFor = (dueDate: string | undefined): FundingStatus => {
    if (!dueDate) return 'no-date'
    if (dueDate < asOf) return 'overdue'
    return monthsBetween(month, dueDate.slice(0, 7)) === 0 ? 'due-now' : 'on-track'
  }
  const events = allEventStatuses(data, today)
  const eventByProvision = new Map(
    (data.events ?? []).filter((e) => e.provisionId).map((e) => [e.provisionId!, e.label]),
  )

  for (const p of allProvisionStatuses(data)) {
    const remaining = round2(Math.max(0, p.targetAmount - p.funded))
    const dueMonth = p.dueDate?.slice(0, 7)
    const status = statusFor(p.dueDate)
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
      amount: remaining > 0 && monthsLeft && status !== 'overdue' ? round2(remaining / monthsLeft) : 0,
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
    const status = statusFor(e.startDate)
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
      amount: remaining > 0 && status !== 'overdue' ? round2(remaining / monthsLeft) : 0,
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
  const lapsed = lines.filter((l) => l.status === 'overdue').sort(sort)
  const due = lines.filter((l) => l.status === 'due-now' || l.status === 'on-track').sort(sort)

  return {
    month,
    total: round2(due.reduce((s, l) => s + l.amount, 0)),
    lines: due,
    settled: settled.sort(sort),
    undated,
    lapsed,
  }
}

// ── Month-end carry-over ──────────────────────────────────────────
// The other direction: not what next month needs, but what this one didn't
// spend. Closing a month leaves a surplus sitting in the current account,
// where it reads as spendable and quietly gets spent. Moving it into savings
// is the last step of a money date.

export interface MonthCarryover {
  month: string
  /** Income minus expenses — the same net the money date reports. */
  net: number
  /** Of that surplus, how much has already been moved into savings. */
  swept: number
  /** Still sitting in the current account, waiting to be moved. */
  left: number
}

/**
 * What a month has left over. Transfers between the user's own accounts are
 * excluded, so the sweep itself doesn't shrink the surplus it came from — the
 * money left the current account but never left their finances.
 */
export function monthCarryover(data: AppData, month: string): MonthCarryover {
  let net = 0
  let swept = 0
  for (const t of data.transactions) {
    if (t.month !== month) continue
    if (t.carryoverFor === month) swept += Math.abs(t.amount)
    if (NON_CASHFLOW.has(t.category)) continue
    net += t.amount
  }
  net = round2(net)
  swept = round2(swept)
  return { month, net, swept, left: round2(Math.max(0, net - swept)) }
}

/**
 * The transfer that carries a month's surplus into the emergency fund. Filed
 * as an internal movement so it never reads as spending, and pre-reconciled
 * because the user just decided it — there is nothing left to confirm.
 */
export function carryoverTransaction(month: string, amount: number, label: string): Transaction {
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return {
    id: uid(),
    date: `${month}-${String(lastDay).padStart(2, '0')}`,
    description: `Left over from ${label} → savings`,
    amount: -round2(amount),
    category: 'Internal',
    source: 'manual',
    month,
    reconciled: true,
    carryoverFor: month,
    provisionAllocations: [
      { provisionId: EMERGENCY_FUND_ID, amount: round2(amount), role: 'contribution' },
    ],
  }
}

// ── Do the pots add up? ───────────────────────────────────────────
// Every pot balance in this app is derived from allocations, which makes it
// internally consistent but says nothing about whether the money is really
// there. Provisioning moves cash into a separate account; this compares what
// the pots claim against what that account actually holds, which is the only
// check that can catch a transfer never made or a pot funded twice.

export interface PotsCheck {
  /** Balance across every named provision. */
  provisions: number
  emergency: number
  total: number
  accountId?: string
  accountName?: string
  accountBalance?: number
  /** The date that balance was last known accurate — the check is only as fresh as this. */
  asOf?: string
  /**
   * accountBalance − total, or null when no account is nominated. Positive:
   * money in the account that no pot has claimed. Negative: the pots promise
   * more than the account holds.
   */
  difference: number | null
}

export function potsCheck(data: AppData): PotsCheck {
  const provisions = round2(
    allProvisionStatuses(data).reduce((s, p) => s + p.funded, 0),
  )
  const emergency = emergencyFundStatus(data).balance
  const total = round2(provisions + emergency)
  const account = data.accounts.find((a) => a.id === data.provisionAccountId)
  return {
    provisions,
    emergency,
    total,
    accountId: account?.id,
    accountName: account?.name,
    accountBalance: account?.balance,
    asOf: account?.asOf,
    difference: account ? round2(account.balance - total) : null,
  }
}
