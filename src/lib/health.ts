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
import { accountBalance, isCardAccount } from './forecast'
import { duplicatePairs } from './month'
import { proposeRefile, type RefileProposal } from './refile'
import { transferCounterparties, counterpartyKey, type Counterparty } from './transfers'
import { potsCheck } from './funding'

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

// ── The checks ────────────────────────────────────────────────────

export type Severity = 'error' | 'warn' | 'info'

/** What fixing an issue takes — the panel turns each into a button. */
export type HealthAction =
  | { kind: 'refile'; proposal: RefileProposal }
  | { kind: 'mark-one-off'; txIds: string[] }
  | { kind: 'resolve-duplicates'; months: string[] }
  | { kind: 'counterparties'; items: Counterparty[] }
  | { kind: 'set-pots-account'; accountId: string; label: string }
  | { kind: 'open'; tab: 'this-month' | 'money-date' | 'plan'; month?: string; label: string }

export interface HealthIssue {
  id: string
  severity: Severity
  title: string
  detail: string
  /** Euros the issue moves, where that is the honest measure of it. */
  amount?: number
  actions?: HealthAction[]
}

/** Repairs `loadData` made silently, so the panel can say they happened. */
export const loadRepairs = { repeatedIds: 0 }

export function runHealthChecks(data: AppData): HealthIssue[] {
  const fx = (n: number) =>
    new Intl.NumberFormat(data.settings.locale, {
      style: 'currency',
      currency: data.settings.currency,
      maximumFractionDigits: 0,
    }).format(n)
  const issues: HealthIssue[] = []

  if (loadRepairs.repeatedIds > 0) {
    issues.push({
      id: 'repeated-ids',
      severity: 'info',
      title: `${loadRepairs.repeatedIds} records stored twice were removed`,
      detail:
        'Each was the same record saved a second time under the same id, by an import whose account was ' +
        'changed before saving. Removing the copies changed no real transaction.',
    })
  }

  // Counted twice: the same spend in the month's figures twice over.
  const dupMonths = [...new Set(data.transactions.map((t) => t.month))]
    .sort()
    .map((m) => ({ month: m, pairs: duplicatePairs(data, m) }))
    .filter((x) => x.pairs.length)
  if (dupMonths.length) {
    const n = dupMonths.reduce((s, x) => s + x.pairs.length, 0)
    const amount = round2(dupMonths.reduce((s, x) => s + x.pairs.reduce((a, p) => a + Math.abs(p.manual.amount), 0), 0))
    issues.push({
      id: 'duplicates',
      severity: 'error',
      title: `${n} lines are counted twice`,
      detail:
        `Spread over ${dupMonths.map((x) => monthName(x.month, data.settings.locale)).join(', ')}, ` +
        `overstating those months by ${fx(amount)}. Each month's screen lists them and keeps the copy you worked on.`,
      amount,
      actions: [
        // Only lines saved twice by an import can be settled in bulk: which
        // copy to keep follows from the work on them. A hand-logged spend
        // against a statement line is a judgement, so those are left to the
        // month's own screen.
        ...(dupMonths.every((x) => x.pairs.every((p) => p.reimport))
          ? [{ kind: 'resolve-duplicates' as const, months: dupMonths.map((x) => x.month) }]
          : []),
        ...dupMonths.map((x) => ({
          kind: 'open' as const,
          tab: 'this-month' as const,
          month: x.month,
          label: `Review ${monthName(x.month, data.settings.locale)} (${x.pairs.length})`,
        })),
      ],
    })
  }

  // Lines filed under an account their own shape says they don't belong to.
  const refile = proposeRefile(data)
  if (refile.moves.length) {
    issues.push({
      id: 'refile',
      severity: 'error',
      title: `${refile.moves.length} lines are filed under the wrong account`,
      detail:
        refile.summary.map((s) => `${s.count} to ${s.toName}`).join(', ') +
        '. A card holding bank and Revolut lines works out its debt from them, so what you owe is wrong until they move.' +
        (refile.createsRevolut ? ' A Revolut account will be created for its lines.' : ''),
      actions: [{ kind: 'refile', proposal: refile }],
    })
  }

  // A card can't be owed money. One that reads that way is holding lines that
  // aren't its own, or missing charges that are — and totals used to count it
  // as zero, which hid the problem rather than showing it.
  for (const a of data.accounts.filter(isCardAccount)) {
    const balance = accountBalance(data, a)
    if (balance <= 0.5) continue
    const misfiled = refile.moves.filter((m) => m.from === a.id).length
    issues.push({
      id: `card-credit:${a.id}`,
      severity: 'error',
      title: `${a.name} reads ${fx(balance)} in credit`,
      detail:
        'A card can only owe money, and until this is fixed it counts as owing nothing. ' +
        (misfiled
          ? `It is holding ${misfiled} lines from other accounts — moving them (above) fixes this.`
          : 'Its payments are here but not the charges they paid for: those are filed under another card. ' +
            'A card line doesn’t say which card it was, so this one is yours to move.'),
      amount: balance,
      actions: [{ kind: 'open', tab: 'plan', label: 'Open accounts' }],
    })
  }

  // One-offs left inside a month's figures.
  const spot = oneOffSpotter(data)
  const candidates = data.transactions.filter(spot)
  if (candidates.length) {
    issues.push({
      id: 'one-offs',
      severity: 'warn',
      title: `${candidates.length} large receipts may be one-offs`,
      detail:
        candidates
          .slice(0, 4)
          .map((t) => `${fx(t.amount)} ${t.description.slice(0, 40)} (${t.date})`)
          .join('; ') +
        '. Counted as ordinary, each throws its month and every average built on it. Marking them keeps them on ' +
        'their own line; the balance still counts them.',
      amount: round2(candidates.reduce((s, t) => s + t.amount, 0)),
      actions: [{ kind: 'mark-one-off', txIds: candidates.map((t) => t.id) }],
    })
  }

  // Transfers with no other side: neither income nor spending, on the promise
  // that they arrived in another of your accounts — which nobody can see.
  const unknown = transferCounterparties(data).filter((c) => !c.decision && c.moneyIn + c.moneyOut >= 1)
  if (unknown.length) {
    const total = round2(unknown.reduce((s, c) => s + c.moneyIn + c.moneyOut, 0))
    issues.push({
      id: 'transfers',
      severity: 'warn',
      title: `${fx(total)} of transfers have no other side`,
      detail:
        'Filed as moves between your own accounts, so they count as neither income nor spending — but the account ' +
        'at the other end isn’t here. Say whether each is yours (it gets an account, not imported yet) or someone ' +
        'else’s (then the money was really received or spent, and is filed that way).',
      amount: total,
      actions: [{ kind: 'counterparties', items: unknown }],
    })
  }

  // Do the pots add up? Their balances come from allocations, which can't tell
  // a transfer never made from one made twice — only the account holding the
  // money can.
  const pots = potsCheck(data)
  if (pots.total > 0.5) {
    const holder = data.accounts.find((a) => a.id === pots.accountId)
    if (!holder) {
      // The account the set-aside transfers went to is the obvious holder.
      const saved = data.transactions.filter((t) => ['Savings', 'Provisions'].includes(t.category) && t.amount < 0)
      const names = new Map<string, number>()
      for (const t of saved) {
        const m = t.description.match(/^to [A-Z]{3} (.+)$/i)?.[1]
        if (m) names.set(counterpartyKey(m), (names.get(counterpartyKey(m)) ?? 0) + 1)
      }
      const likely = data.accounts
        .filter((a) => !isCardAccount(a) && (names.get(counterpartyKey(a.name)) ?? 0) > 0)
        .sort((a, b) => (names.get(counterpartyKey(b.name)) ?? 0) - (names.get(counterpartyKey(a.name)) ?? 0))[0]
      issues.push({
        id: 'pots-unbacked',
        severity: 'warn',
        title: `Your pots claim ${fx(pots.total)}, and no account is named as holding it`,
        detail:
          'Pot balances are worked out from what you allocated, so a transfer never made or credited twice looks ' +
          'exactly like one that happened. Naming the account they live in lets the two be compared.' +
          (likely ? ` Your set-aside transfers went to ${likely.name}.` : ''),
        amount: pots.total,
        actions: likely
          ? [{ kind: 'set-pots-account', accountId: likely.id, label: `It's ${likely.name}` }, { kind: 'open', tab: 'plan', label: 'Choose another' }]
          : [{ kind: 'open', tab: 'plan', label: 'Choose the account' }],
      })
    } else if (!holder.asOf) {
      issues.push({
        id: 'pots-no-balance',
        severity: 'warn',
        title: `Enter what ${holder.name} holds`,
        detail: `Your pots claim ${fx(pots.total)} there. Without its real balance there is nothing to check that against.`,
        actions: [{ kind: 'open', tab: 'plan', label: 'Enter the balance' }],
      })
    } else if (pots.difference !== null && Math.abs(pots.difference) > 1) {
      issues.push({
        id: 'pots-gap',
        severity: pots.difference < 0 ? 'error' : 'info',
        title:
          pots.difference < 0
            ? `Your pots claim ${fx(-pots.difference)} more than ${holder.name} holds`
            : `${holder.name} holds ${fx(pots.difference)} no pot has claimed`,
        detail:
          `Pots ${fx(pots.total)} against ${fx(pots.accountBalance ?? 0)} in ${holder.name} as of ${holder.asOf}. ` +
          (pots.difference < 0
            ? 'A pot credited for money that never arrived, or the balance is out of date.'
            : 'Money set aside without being given to a pot — allocate it, or it is spare.'),
        amount: Math.abs(pots.difference),
        actions: [{ kind: 'open', tab: 'plan', label: 'Open pots' }],
      })
    }
  }

  const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 }
  return issues.sort((a, b) => order[a.severity] - order[b.severity])
}

function monthName(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: 'short', year: 'numeric' })
}
