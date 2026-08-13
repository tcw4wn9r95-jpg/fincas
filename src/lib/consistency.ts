import type { AppData } from './types'
import { addMonths, currentMonth, formatMonthLabel, normDescription } from './format'
import {
  EMERGENCY_FUND_ID,
  EMERGENCY_FUND_LABEL,
  allProvisionStatuses,
  allocatedTotal,
  emergencyFundStatus,
  transactionAllocations,
} from './provisions'
import { anchorMonth, hasBalanceAnchor, monthsWithData } from './forecast'

// ── Does the data hold together? ──────────────────────────────────
// Every figure in this app is derived from what has been imported, which makes
// it internally consistent and says nothing about whether what was imported is
// right. These checks look for the handful of states that quietly make the
// numbers lie: no balance to project from, a balance older than the data, money
// allocated twice, pots pointing at provisions that no longer exist, a month
// never imported. Nothing here changes data — it reports, and says where to go.

export type CheckLevel = 'blocker' | 'warn' | 'info'

export interface DataCheck {
  id: string
  level: CheckLevel
  title: string
  /** One sentence: what is wrong and what it does to the numbers. */
  detail: string
  /** Where to fix it. */
  fix?: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** Keeps a count-driven sentence reading properly whether it found one or nine. */
const agree = (n: number) =>
  n === 1
    ? { it: 'it', they: 'it', them: 'it', those: 'that one', sit: 'sits' }
    : { it: 'they', they: 'they', them: 'them', those: 'those', sit: 'sit' }

export function dataChecks(data: AppData): DataCheck[] {
  const out: DataCheck[] = []
  const now = currentMonth()
  const locale = data.settings.locale
  const months = monthsWithData(data) // newest first
  const latestData = months[0]
  const earliestData = months[months.length - 1]

  // ── The starting point ──
  if (!hasBalanceAnchor(data)) {
    const awaiting = data.accounts.some((a) => a.tracked)
    out.push({
      id: 'no-accounts',
      level: 'blocker',
      title: awaiting ? 'No balance recorded yet' : 'No account to project from',
      detail:
        'Nothing records what you actually hold, so the forecast can only show flows — any balance line would be drawn from zero, which would read as a fact and be a guess.',
      fix: awaiting
        ? 'Import a current-account statement and the tracked account fills itself, or type a balance on another account.'
        : 'Add an account below, or let the tracked account take the closing balance off your current-account statements.',
    })
  } else {
    const anchor = anchorMonth(data)
    // The anchor is the first month the balances do *not* cover, so data in it
    // or later is data the balance has not caught up with.
    if (latestData && latestData >= anchor && anchor <= now) {
      const covered = addMonths(anchor, -1)
      out.push({
        id: 'stale-balance',
        level: 'warn',
        title: 'Balance older than your data',
        detail: `Your balances are good through ${formatMonthLabel(covered, locale)}, but you have imported through ${formatMonthLabel(latestData, locale)}. Everything after that is rolled forward from the plan rather than known.`,
        fix: 'Import the current-account statement for those months, or type the balance you hold today.',
      })
    }
  }

  if (data.recurring.length === 0 && data.transactions.length > 0) {
    out.push({
      id: 'no-plan',
      level: 'warn',
      title: 'Nothing planned',
      detail:
        'You have imported months but no plan lines, so every "vs plan" figure compares against zero and the forecast has nothing to project.',
      fix: 'Build your monthly plan below.',
    })
  }

  // ── Allocations ──
  const provisionIds = new Set<string>(data.provisions.map((p) => p.id))
  provisionIds.add(EMERGENCY_FUND_ID)
  let overAllocated = 0
  let orphaned = 0
  for (const t of data.transactions) {
    if (allocatedTotal(t) > Math.abs(t.amount) + 0.005) overAllocated++
    for (const a of transactionAllocations(t)) {
      if (!provisionIds.has(a.provisionId)) {
        orphaned++
        break
      }
    }
  }
  if (overAllocated > 0) {
    out.push({
      id: 'over-allocated',
      level: 'warn',
      title: `${plural(overAllocated, 'transaction')} split beyond what it moved`,
      detail:
        'More money is spread across pots than the transaction itself carried, so those pots read higher than what is really in them.',
      fix: `Reopen ${agree(overAllocated).them} in a money date and split again.`,
    })
  }
  if (orphaned > 0) {
    out.push({
      id: 'orphan-allocations',
      level: 'warn',
      title: `${plural(orphaned, 'transaction')} pointing at a deleted pot`,
      detail:
        'Money is earmarked for a provision that no longer exists, so it counts as set aside without showing up in any pot.',
      fix: `Re-allocate ${agree(orphaned).them}, or recreate the provision.`,
    })
  }

  // ── Pots drawn past empty ──
  const ef = emergencyFundStatus(data)
  const overdrawn: string[] = allProvisionStatuses(data)
    .filter((p) => p.overdrawn > 0.005)
    .map((p) => p.label)
  if (ef.overdrawn > 0.005) overdrawn.push(EMERGENCY_FUND_LABEL)
  if (overdrawn.length > 0) {
    out.push({
      id: 'overdrawn-pots',
      level: 'warn',
      title: `${plural(overdrawn.length, 'pot')} drawn past empty`,
      detail: `${overdrawn.join(', ')} paid out more than was ever paid in — either a contribution was never recorded, or that spending came from somewhere else.`,
      fix: `Check the drawdowns on ${agree(overdrawn.length).those} in your money dates.`,
    })
  }

  // ── Months ──
  if (earliestData && latestData) {
    const missing: string[] = []
    for (let m = earliestData; m < latestData; m = addMonths(m, 1)) {
      if (!months.includes(m)) missing.push(m)
    }
    if (missing.length > 0) {
      const a = agree(missing.length)
      out.push({
        id: 'month-gap',
        level: 'info',
        title: `${plural(missing.length, 'month')} never imported`,
        detail: `${missing.map((m) => formatMonthLabel(m, locale)).join(', ')} — no transactions at all, though ${a.it} ${a.sit} inside the range you have imported. The track record skips ${a.them}, and any balance rolled through uses the plan.`,
        fix: `Import ${a.those} in a money date.`,
      })
    }
  }

  const unreconciled = data.transactions.filter((t) => t.month < now && !t.reconciled).length
  if (unreconciled > 0) {
    out.push({
      id: 'unreconciled-past',
      level: 'info',
      title: `${plural(unreconciled, 'transaction')} still unreconciled`,
      detail:
        'Unreconciled lines count in the totals, but nobody has confirmed the category — which is where a mis-filed line quietly distorts a month.',
      fix: 'Finish the money date for the months they land in.',
    })
  }

  // ── Double imports ──
  const seen = new Map<string, number>()
  for (const t of data.transactions) {
    const key = `${t.date}|${t.amount}|${normDescription(t.description)}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const dupes = Array.from(seen.values()).filter((n) => n > 1).length
  if (dupes > 0) {
    out.push({
      id: 'duplicates',
      level: 'info',
      title: `${plural(dupes, 'line')} appearing more than once`,
      detail:
        'Same day, same amount, same description. Some are genuinely repeated (two identical coffees), but this is also what a statement imported twice looks like.',
      fix: 'Scan those months in a money date and delete any real duplicate.',
    })
  }

  return out
}

/** Worst level present, for the summary line. */
export function checksLevel(checks: DataCheck[]): CheckLevel | null {
  if (checks.some((c) => c.level === 'blocker')) return 'blocker'
  if (checks.some((c) => c.level === 'warn')) return 'warn'
  if (checks.some((c) => c.level === 'info')) return 'info'
  return null
}
