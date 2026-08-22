import type { AppData, EventExpense, Provision, SpecialEvent, Transaction } from './types'
import { provisionStatus } from './provisions'

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
  const setAside = fund ? provisionStatus(data, fund).funded : 0

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

/** The logged line a newly tagged transaction most likely already stands for. */
export function matchingExpense(e: SpecialEvent, tx: Transaction): EventExpense | undefined {
  const amount = round2(Math.abs(tx.amount))
  return pendingExpenses(e).find((x) => Math.abs(x.amount - amount) < 0.005)
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
  const lists = [d.transactions, d.sampleTransactions ?? []]
  for (const list of lists) {
    for (const t of list) {
      if (t.id !== txId) continue
      // Leaving an event releases whatever was standing in for this line.
      const previous = t.eventId ? d.events?.find((x) => x.id === t.eventId) : undefined
      if (previous) for (const x of previous.expenses) if (x.matchedTxId === txId) x.matchedTxId = undefined
      t.eventId = eventId
      if (!eventId) continue
      const e = d.events?.find((x) => x.id === eventId)
      if (!e) continue
      const chosen = matchExpenseId
        ? e.expenses.find((x) => x.id === matchExpenseId)
        : matchingExpense(e, t)
      if (chosen) chosen.matchedTxId = t.id
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
    (e.hasProvision ? `, ${fx(e.setAside)} set aside` : '') +
    (e.over ? ` — over by ${fx(-e.remaining)}` : `, ${fx(e.remaining)} left`)
  )
}
