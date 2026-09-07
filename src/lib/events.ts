import type { AppData, EventExpense, Provision, SpecialEvent, Transaction } from './types'
import {
  addAllocation,
  dropAllocations,
  potBalance,
  provisionStatus,
  transactionAllocations,
  unallocatedAmount,
} from './provisions'
import { foreignLineMatches } from './fx'

// Special events (a trip, a party) are budgeted as a lump and spent in a burst.
// Two things feed the running total, and they must never both count the same
// euro: lines logged by hand while it's happening, and the real transactions
// that show up later in a statement or a weekly export. A logged line retires
// itself (`matchedTxId`) as soon as its real counterpart is tagged, so the
// number on screen starts as your own tally and converges to the truth.

const round2 = (n: number) => Math.round(n * 100) / 100

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

export type EventSource = 'month' | 'week'

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Every YYYY-MM an event touches, in order. */
export function eventMonths(e: Pick<SpecialEvent, 'startDate' | 'endDate'>): string[] {
  const out: string[] = []
  const last = e.endDate.slice(0, 7)
  let m = e.startDate.slice(0, 7)
  // A malformed range (end before start) would otherwise spin forever.
  for (let guard = 0; m <= last && guard < 120; guard++) {
    out.push(m)
    const [y, mm] = m.split('-').map(Number)
    const d = new Date(y, mm, 1)
    m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return out
}

/**
 * The share of an event's budget that belongs to one month, split by the days
 * it actually runs there. A trip from the 28th to the 5th is mostly next
 * month's problem, and charging either month the whole budget would say the
 * same money is due twice.
 */
export function eventBudgetForMonth(
  e: Pick<SpecialEvent, 'startDate' | 'endDate' | 'budget'>,
  month: string,
): number {
  if (month < e.startDate.slice(0, 7) || month > e.endDate.slice(0, 7)) return 0
  const first = e.startDate > `${month}-01` ? e.startDate : `${month}-01`
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
  const last = e.endDate < monthEnd ? e.endDate : monthEnd
  const here = daysBetween(first, last) + 1
  const total = daysBetween(e.startDate, e.endDate) + 1
  if (total <= 0 || here <= 0) return 0
  return round2((e.budget * here) / total)
}

/**
 * The sinking fund an event saves into. It is an ordinary `Provision` on
 * purpose — that is what lets it show up in the plan, take money through the
 * same allocation pop-up as every other pot, and be drawn down when the trip
 * finally happens — so this only pins the handful of fields that have to agree
 * with the event they belong to.
 *
 * Shared rather than written out at each call site: a fund started later from
 * the event screen must be indistinguishable from one created alongside the
 * event, and the way you end up with a pot due on the wrong day is by building
 * it twice.
 */
export function eventProvisionDraft(
  e: Pick<SpecialEvent, 'label' | 'category' | 'budget' | 'startDate'>,
  id: string,
  createdAt: string,
): Provision {
  return {
    id,
    label: e.label,
    category: e.category,
    targetAmount: e.budget,
    // Due the day it starts. The money has to be there before the first
    // night's hotel, not by the time you get home.
    dueDate: e.startDate,
    createdAt,
  }
}

/** The pot an event saves into, if it asked for one and it still exists. */
export function eventProvision(
  data: AppData,
  e: Pick<SpecialEvent, 'provisionId'>,
): Provision | undefined {
  return e.provisionId ? data.provisions.find((p) => p.id === e.provisionId) : undefined
}

/**
 * Take a spend out of the event's own pot, in place on a store draft, and
 * return what it drew.
 *
 * This is the other half of tagging. Filing a charge under a trip says what it
 * was for; this says where the money came from — and when a pot was funded for
 * exactly this, the answer is not in doubt. Leaving it to a second pass through
 * the allocation pop-up meant a trip that was fully provisioned still read as
 * having a full pot *and* a budget left to spend, which is the same money
 * counted twice.
 *
 * Deliberately bounded four ways, because a draw that is wrong is worse than
 * one that is missing:
 *
 *  - never more than the pot holds, so an event never spends money it was
 *    never given;
 *  - never past the budget. The pot was funded to pay for the plan, and money
 *    spent beyond the plan is overspend: it belongs to the month, where it can
 *    be felt. A pot that happens to hold more than the budget would otherwise
 *    absorb a blown budget without anything anywhere saying so;
 *  - never more of the line than is still unallocated, so a transaction already
 *    split across other pots keeps those splits intact;
 *  - never over an allocation someone typed. A figure entered by hand is a
 *    decision; only the app's own draw (`auto`) is topped up or taken back.
 *
 * Whichever way it is bounded, the tagging itself always stands: what the pot
 * will not cover still counts as this event's spending, because the point of
 * tagging is to know what the trip really cost.
 */
export function drawFromEventFund(d: AppData, e: SpecialEvent, t: Transaction): number {
  // Money coming back is not a spend the pot can pay for, and putting a refund
  // back into the pot is a decision rather than a consequence of tagging.
  if (t.amount >= 0) return 0
  const fund = eventProvision(d, e)
  if (!fund) return 0
  const existing = transactionAllocations(t)
  // One line moves money one way — the pop-up picks a single direction for the
  // whole split — so a transfer that is putting money away is left alone.
  if (existing.some((a) => a.role === 'contribution')) return 0
  const mine = existing.find((a) => a.provisionId === fund.id)
  if (mine && !mine.auto) return 0
  const pot = potBalance(d, fund.id)
  // The pot's own drawdowns are this event's, so what it has already paid is
  // what has been claimed against the budget.
  const budgetLeft = round2(Math.max(0, e.budget - pot.drawn))
  const amount = round2(
    Math.min(unallocatedAmount(t), Math.max(0, pot.balance), budgetLeft),
  )
  if (amount < 0.005) return 0
  // Rebuilt rather than mutated in place: `transactionAllocations` hands back
  // fabricated rows for legacy single-link data, where editing the copy would
  // change nothing at all.
  const total = mine ? round2(mine.amount + amount) : amount
  if (mine) dropAllocations(t, (a) => a.provisionId === fund.id)
  addAllocation(t, { provisionId: fund.id, amount: total, role: 'drawdown', auto: true })
  return amount
}

/**
 * Give back what tagging took. Only the draws this app made itself: a figure
 * someone typed is theirs, and a spend leaving an event is no reason to undo a
 * decision they made on purpose.
 */
export function releaseEventFund(e: Pick<SpecialEvent, 'provisionId'>, t: Transaction): void {
  if (!e.provisionId) return
  dropAllocations(t, (a) => !!a.auto && a.role === 'drawdown' && a.provisionId === e.provisionId)
}

/**
 * Pay for everything this event has already cost out of what is still in its
 * pot — the catch-up for spends tagged before the money was there. Returns what
 * it drew in total.
 *
 * Oldest first, until the pot runs dry: the money went in to be spent in the
 * order the trip happened, and a rule that spends it in date order is one the
 * reader can predict.
 */
export function settleEventFromFund(d: AppData, eventId: string): number {
  const e = d.events?.find((x) => x.id === eventId)
  if (!e || !eventProvision(d, e)) return 0
  let drawn = 0
  const spends = d.transactions
    .filter((t) => t.eventId === eventId && t.amount < 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const t of spends) drawn = round2(drawn + drawFromEventFund(d, e, t))
  return drawn
}

/**
 * Settle every event against its own pot, in place. Run on load, so a pot that
 * has money in it and an event that was paid for out of the month can never sit
 * side by side.
 *
 * This is not only a migration for data written before tagging did the draw.
 * The gap reopens in ordinary use — a spend tagged while the pot was still
 * empty, then a transfer into the pot the following month — and the answer both
 * times is the same one the event screen no longer asks about: money put by for
 * a trip pays for that trip. Making it a button meant an event could be left
 * quietly wrong by not pressing it, which is the whole complaint this loop
 * started from.
 *
 * Idempotent by construction: `drawFromEventFund` is bounded by what is still
 * unallocated and by what the pot still holds, so a settled event draws nothing
 * on the next pass.
 */
export function settleEventFunds(d: AppData): AppData {
  for (const e of d.events ?? []) settleEventFromFund(d, e.id)
  return d
}

/** Same spend seen twice — used to keep the weekly sample from double-counting the statement. */
const dedupeKey = (t: Transaction) => `${t.date}|${t.amount}`

export interface EventTaggedTx {
  tx: Transaction
  source: EventSource
}

/**
 * Real transactions tagged to this event. The monthly statement wins: a weekly
 * sample row for the same date and amount is dropped, since the two datasets
 * overlap by design (see `AppData.sampleTransactions`).
 */
export function eventTransactions(data: AppData, eventId: string): EventTaggedTx[] {
  const monthly = data.transactions.filter((t) => t.eventId === eventId)
  const seen = new Set(monthly.map(dedupeKey))
  const weekly = (data.sampleTransactions ?? []).filter(
    (t) => t.eventId === eventId && !seen.has(dedupeKey(t)),
  )
  return [
    ...monthly.map((tx) => ({ tx, source: 'month' as const })),
    ...weekly.map((tx) => ({ tx, source: 'week' as const })),
  ].sort((a, b) => a.tx.date.localeCompare(b.tx.date))
}

/** Logged lines still waiting for their real counterpart to turn up. */
export function pendingExpenses(e: SpecialEvent): EventExpense[] {
  return e.expenses.filter((x) => !x.matchedTxId)
}

export type EventPhase = 'upcoming' | 'live' | 'past'

export interface EventStatus {
  id: string
  label: string
  kind: SpecialEvent['kind']
  startDate: string
  endDate: string
  category: string
  budget: number
  /** Spend confirmed by a real transaction. */
  confirmed: number
  /** Logged by hand and not yet matched — your own tally, still unverified. */
  pending: number
  /** confirmed + pending: the working total to judge the budget against. */
  spent: number
  /** budget − spent (negative = over). */
  remaining: number
  pct: number
  over: boolean
  /** Funded so far by the linked provision, if there is one. */
  setAside: number
  /** Taken back out of that pot to pay for the event. */
  fundDrawn: number
  /**
   * Confirmed spending the pot did not cover, so a month is carrying it: the
   * pot ran dry, the spend went past the budget, or there was never a pot at
   * all. Always `confirmed − fundDrawn`, so the two account for every euro that
   * has actually left the bank and the split can be shown without a remainder.
   */
  outOfPocket: number
  hasProvision: boolean
  phase: EventPhase
  /** Days until it starts (upcoming), or days it runs / ran. */
  daysToStart: number
  byCategory: { category: string; amount: number }[]
  txCount: number
  pendingCount: number
}

export function eventStatus(data: AppData, e: SpecialEvent, today: string): EventStatus {
  const tagged = eventTransactions(data, e.id)
  const pendingList = pendingExpenses(e)

  const byCat = new Map<string, number>()
  let confirmed = 0
  for (const { tx } of tagged) {
    // Money back (a refund) nets off rather than reading as more spending.
    const amount = round2(-tx.amount)
    confirmed += amount
    byCat.set(tx.category, round2((byCat.get(tx.category) ?? 0) + amount))
  }
  let pending = 0
  for (const x of pendingList) {
    pending += x.amount
    byCat.set(x.category, round2((byCat.get(x.category) ?? 0) + x.amount))
  }

  confirmed = round2(confirmed)
  pending = round2(pending)
  const spent = round2(confirmed + pending)
  const fund = eventProvision(data, e)
  const fundStatus = fund ? provisionStatus(data, fund) : undefined
  const setAside = fundStatus?.funded ?? 0
  const fundDrawn = fundStatus?.drawn ?? 0
  // Measured against confirmed spending alone, so the two parts always add back
  // up to it. A line logged by hand has not reached the bank, so no month is
  // carrying it yet and the pot has not paid it either — counting it here would
  // report a shortfall that exists only until the statement lands, and would
  // leave the split on screen adding up to less than the total it sits under.
  const outOfPocket = round2(Math.max(0, confirmed - fundDrawn))

  const phase: EventPhase = today < e.startDate ? 'upcoming' : today > e.endDate ? 'past' : 'live'

  return {
    id: e.id,
    label: e.label,
    kind: e.kind,
    startDate: e.startDate,
    endDate: e.endDate,
    category: e.category,
    budget: e.budget,
    confirmed,
    pending,
    spent,
    remaining: round2(e.budget - spent),
    pct: e.budget > 0 ? Math.round((spent / e.budget) * 100) : 0,
    over: spent > e.budget + 0.005,
    setAside,
    fundDrawn,
    outOfPocket,
    hasProvision: !!fund,
    phase,
    daysToStart: daysBetween(today, e.startDate),
    byCategory: Array.from(byCat.entries())
      .map(([category, amount]) => ({ category, amount }))
      .filter((c) => Math.abs(c.amount) > 0.005)
      .sort((a, b) => b.amount - a.amount),
    txCount: tagged.length,
    pendingCount: pendingList.length,
  }
}

export function allEventStatuses(data: AppData, today: string): EventStatus[] {
  // Live first (that's the one you're standing in), then soonest upcoming,
  // then most recent past.
  const rank = { live: 0, upcoming: 1, past: 2 }
  return (data.events ?? [])
    .map((e) => eventStatus(data, e, today))
    .sort(
      (a, b) =>
        rank[a.phase] - rank[b.phase] ||
        (a.phase === 'past' ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate)),
    )
}

/**
 * Transactions inside the event's dates that aren't tagged to any event yet —
 * what the month-end (or weekly) import turns up for review. Never tagged
 * automatically: rent landing mid-trip is not trip spending.
 */
export function eventCandidates(data: AppData, e: SpecialEvent): EventTaggedTx[] {
  const inWindow = (t: Transaction) =>
    !t.eventId && t.amount < 0 && t.date >= e.startDate && t.date <= e.endDate && t.category !== 'Internal'
  const monthly = data.transactions.filter(inWindow)
  const seen = new Set(monthly.map(dedupeKey))
  const weekly = (data.sampleTransactions ?? []).filter((t) => inWindow(t) && !seen.has(dedupeKey(t)))
  return [
    ...monthly.map((tx) => ({ tx, source: 'month' as const })),
    ...weekly.map((tx) => ({ tx, source: 'week' as const })),
  ].sort((a, b) => a.tx.date.localeCompare(b.tx.date))
}

/**
 * The logged line a newly tagged transaction most likely already stands for.
 *
 * A line paid abroad answers to either figure — the original currency, or the
 * bank's own conversion of it — since a trip is exactly when a hand-logged
 * spend and the charge that settles it are quoted in different money.
 */
export function matchingExpense(e: SpecialEvent, tx: Transaction): EventExpense | undefined {
  const amount = round2(Math.abs(tx.amount))
  const pending = pendingExpenses(e)
  return (
    pending.find((x) => Math.abs(x.amount - amount) < 0.005) ??
    pending.find((x) => x.foreign && foreignLineMatches({ ...x, amount: -x.amount }, tx))
  )
}

/**
 * A line logged during the event that looks like this transaction but does not
 * agree with it — the tip you added, the round someone else put in, the rate
 * the card actually settled at. Close enough to be worth asking about, never
 * close enough to retire silently: the whole point of the logged tally is that
 * it is your own account of what happened, and quietly overwriting it with a
 * statement that differs would lose the disagreement rather than surface it.
 *
 * Only offered when nothing matches exactly, since an exact match is not a
 * discrepancy and needs no question.
 */
export function nearMatchExpense(e: SpecialEvent, tx: Transaction): EventExpense | undefined {
  if (matchingExpense(e, tx)) return undefined
  const amount = round2(Math.abs(tx.amount))
  let best: EventExpense | undefined
  let bestGap = Infinity
  for (const x of pendingExpenses(e)) {
    const gap = Math.abs(x.amount - amount)
    // Within a quarter of the size, or a tenner, and within a few days.
    if (gap > Math.max(10, amount * 0.25)) continue
    if (Math.abs(daysBetween(x.date, tx.date)) > 3) continue
    if (gap < bestGap) {
      best = x
      bestGap = gap
    }
  }
  return best
}

/**
 * Claim a real transaction for an event, in place on a store draft. A line
 * logged by hand for the same amount retires rather than double-counting;
 * untagging releases it again.
 *
 * Lives here rather than in the events screen because the same thing has to
 * happen from reconcile, where most transactions are actually seen for the
 * first time.
 */
export function tagTransactionToEvent(
  d: AppData,
  eventId: string | undefined,
  txId: string,
  /** Retire this logged line as the transaction's counterpart, whatever it says. */
  matchExpenseId?: string,
): void {
  // Only real transactions move a pot: the weekly sample is a duplicate view of
  // the same spending (see `AppData.sampleTransactions`), and drawing on its
  // rows too would take the same euro out of the pot twice.
  const lists: [Transaction[], boolean][] = [
    [d.transactions, true],
    [d.sampleTransactions ?? [], false],
  ]
  for (const [list, real] of lists) {
    for (const t of list) {
      if (t.id !== txId) continue
      // Leaving an event releases whatever was standing in for this line — the
      // logged expense it retired, and the draw its pot made for it.
      const previous = t.eventId ? d.events?.find((x) => x.id === t.eventId) : undefined
      if (previous) {
        for (const x of previous.expenses) if (x.matchedTxId === txId) x.matchedTxId = undefined
        if (real) releaseEventFund(previous, t)
      }
      t.eventId = eventId
      if (!eventId) continue
      const e = d.events?.find((x) => x.id === eventId)
      if (!e) continue
      const chosen = matchExpenseId
        ? e.expenses.find((x) => x.id === matchExpenseId)
        : matchingExpense(e, t)
      if (chosen) chosen.matchedTxId = t.id
      // The other half of the same decision: what it was for, and where the
      // money came from. Saying only the first is what left a fully funded trip
      // showing a full pot and an untouched budget at the same time.
      if (real) drawFromEventFund(d, e, t)
    }
  }
}

/** Events overlapping a YYYY-MM month — the money date's "how did the trip go". */
export function eventsInMonth(data: AppData, month: string, today: string): EventStatus[] {
  const first = `${month}-01`
  const last = `${month}-31`
  return allEventStatuses(data, today).filter((e) => e.startDate <= last && e.endDate >= first)
}

/** Events overlapping a date range — used by the weekly check-in. */
export function eventsInRange(data: AppData, startISO: string, endISO: string, today: string): EventStatus[] {
  return allEventStatuses(data, today).filter((e) => e.startDate <= endISO && e.endDate >= startISO)
}

/** Model-friendly summary for the assistant's context. */
export function eventSummaryLine(e: EventStatus, fx: (n: number) => string): string {
  const when =
    e.phase === 'upcoming' ? `starts in ${e.daysToStart} day(s)` : e.phase === 'live' ? 'happening now' : 'finished'
  return (
    `${e.label} [${e.category}, ${when}, ${e.startDate}${e.endDate !== e.startDate ? `–${e.endDate}` : ''}]: ` +
    `${fx(e.spent)} spent of ${fx(e.budget)} budget` +
    (e.pending > 0.005 ? ` (${fx(e.pending)} of that logged by hand, not yet in a statement)` : '') +
    (e.hasProvision
      ? `, ${fx(e.setAside)} left in its pot` +
        (e.fundDrawn > 0.005 ? ` after ${fx(e.fundDrawn)} paid out of it` : '') +
        (e.outOfPocket > 0.005 ? `, ${fx(e.outOfPocket)} of it paid by the month instead` : '')
      : '') +
    (e.over ? ` — over by ${fx(-e.remaining)}` : `, ${fx(e.remaining)} left`)
  )
}
