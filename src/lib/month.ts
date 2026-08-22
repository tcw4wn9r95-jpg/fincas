import type { AppData, RecurringItem, Transaction } from './types'
import {
  computeReview,
  isPlannedSetAside,
  itemAmountForMonth,
  actualsByCategoryRange,
  nextOccurrence,
  FIXED_COST_CATEGORIES,
} from './forecast'
import { NON_CASHFLOW } from './categorize'
import { addMonths, currentMonth, todayISO } from './format'

// The current month, while it is still being lived in — as opposed to the money
// date, which reviews a month once its statement has arrived and every line is
// settled. Here spending is logged by hand as it happens, a Revolut export is
// dropped in part-way through, and the question being asked is always the same
// one: given what has already gone out and what is still coming, can I spend
// this?

const round2 = (n: number) => Math.round(n * 100) / 100

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/**
 * How far into `month` we are: the day count that has actually happened, so a
 * pace on the 8th divides by 8 rather than by 31. A month already past is
 * fully elapsed; one still ahead has not started.
 */
export function monthProgress(month: string, today = todayISO()): { elapsed: number; total: number } {
  const total = daysInMonth(month)
  const nowMonth = today.slice(0, 7)
  if (month < nowMonth) return { elapsed: total, total }
  if (month > nowMonth) return { elapsed: 0, total }
  return { elapsed: Math.min(total, Number(today.slice(8, 10))), total }
}

export interface PendingBill {
  id: string
  label: string
  category: string
  /** What the plan says this line costs in this month. */
  amount: number
  /** The day of the month it usually lands, from history — or the plan's own start day. */
  typicalDay: number
  /** True once that day has passed and nothing matching has shown up. */
  overdue: boolean
  /**
   * A fixed cost the month would normally count as settled on its own — here
   * only because it was explicitly un-assumed. Everything else in this list is
   * simply a bill nothing has answered to yet.
   */
  unassumed: boolean
}

/**
 * The charge that has answered to a plan line this month, if one has — its id
 * and what it actually cost, or `null` while the line is still outstanding.
 *
 * Matched on the line's category at roughly its size. Roughly, because a bill
 * that moves by a few euros month to month (a utility, a variable-rate loan) is
 * still that bill, and demanding an exact match would report every one of them
 * as still to come.
 *
 * `assumedAt` widens that to what the month is currently counting for the line.
 * Correcting an assumption is the user saying what the bill really came to, so
 * the charge that proves them right must be recognised — a €104 electricity
 * bill on a €90 plan line sits just outside the plan's tolerance, and the
 * pocket would have gone on being counted as assumed *and* filled by the
 * charge, which is the one thing this whole model exists to prevent.
 *
 * `claimed` stops two plan lines in one category (electricity and water, say)
 * both settling themselves against the same charge.
 */
function arrivedCharge(
  item: RecurringItem,
  planAmount: number,
  monthTxs: Transaction[],
  assumedAt: number | null,
  claimed: Set<string>,
): { id: string; amount: number } | null {
  const targets = [planAmount]
  if (assumedAt !== null && Math.abs(assumedAt - planAmount) > 0.005) targets.push(assumedAt)
  let best: { id: string; amount: number } | null = null
  let bestGap = Infinity
  for (const t of monthTxs) {
    if (t.amount >= 0 || t.category !== item.category || claimed.has(t.id)) continue
    const size = Math.abs(t.amount)
    for (const target of targets) {
      const gap = Math.abs(size - target)
      if (gap > Math.max(2, target * 0.15) || gap >= bestGap) continue
      best = { id: t.id, amount: round2(size) }
      bestGap = gap
    }
  }
  return best
}

/**
 * Days of the month this line has landed on before — every past transaction in
 * its category at roughly its size.
 */
function historyDays(data: AppData, item: RecurringItem, amount: number, month: string): number[] {
  const tol = Math.max(2, amount * 0.25)
  const days: number[] = []
  for (const t of data.transactions) {
    if (t.month >= month || t.category !== item.category || t.amount >= 0) continue
    if (Math.abs(Math.abs(t.amount) - amount) > tol) continue
    days.push(Number(t.date.slice(8, 10)))
  }
  return days.sort((a, b) => a - b)
}

/**
 * The categories that arrive as many small purchases rather than one charge —
 * the everyday half of a month. A grocery budget is never a bill, however the
 * month's shops happen to have fallen: a €150 food budget against a history
 * containing one €140 shop used to look exactly like a €150 bill that lands
 * once, so Food was listed as "still to land" and its whole budget counted as
 * money yet to leave in a lump. It is spent a basket at a time, and what is
 * useful about it is the daily allowance, not a due date.
 */
const SPREAD_CATEGORIES = new Set([
  'Food',
  'Dining',
  'Shopping',
  'Entertainment',
  'Transport',
  'Home expenses',
  'Other',
])

/**
 * Whether a plan line is the kind that lands as one identifiable charge — a
 * rent, a loan, an insurance premium — as opposed to a budget spread over many
 * small ones.
 *
 * The two lists above answer it outright where they apply. Everything else is
 * decided by history: a single charge of about this size, in a month gone by,
 * makes it a bill; spending in the category with no such charge makes it a
 * budget. With nothing at all to go on it defaults to a bill, because most of
 * what anyone bothers to plan for (a rent, a fee, a term's tuition) is one —
 * and notably not through the planner's own fixed/variable split, which calls
 * Housing variable and would leave rent invisible on a plan that has not run a
 * month yet.
 */
function looksDiscrete(data: AppData, item: RecurringItem, amount: number, month: string): boolean {
  // Both of these settle the question outright, in opposite directions, and
  // history gets no say over either.
  //
  // A loan, a utility, an insurance premium and a subscription are bills by
  // declaration — the four the month assumes paid without being asked. And a
  // grocery or dining budget is never a bill however its charges happen to have
  // fallen. Letting history overrule the first left insurance silently never
  // assumed; letting it overrule the second put Food in a list of things still
  // to land, which is what the whole distinction exists to prevent.
  if (FIXED_COST_CATEGORIES.has(item.category)) return true
  if (SPREAD_CATEGORIES.has(item.category) || item.group === 'Variable') return false
  if (historyDays(data, item, amount, month).length > 0) return true
  // Spending in the category with no single charge that size is what a budget
  // spread over many purchases looks like.
  return !data.transactions.some(
    (t) => t.month < month && t.category === item.category && t.amount < 0,
  )
}

/** The day of the month this line has historically landed on, median of what we've seen. */
function typicalDayFor(data: AppData, item: RecurringItem, amount: number, month: string): number {
  const days = historyDays(data, item, amount, month)
  if (!days.length) {
    const planned = item.dayOfMonth ?? Number(item.startDate?.slice(8, 10) ?? 0)
    return planned > 0 ? planned : 1
  }
  return days[Math.floor(days.length / 2)]
}

export interface UpcomingBill {
  id: string
  label: string
  category: string
  amount: number
  /** The month it next lands, and the full date within it. */
  month: string
  date: string
}

export interface CategoryPulse {
  category: string
  planned: number
  actual: number
  /** planned − actual, floored at nothing: what the budget still has in it. */
  left: number
  /** Over-plan by this much, or 0. */
  over: number
  /** Average actual spend in this category over the previous `TREND_MONTHS`. */
  average: number
  /** actual − average: how this month is running against the recent norm. */
  vsAverage: number
  /** Where the month's elapsed days say this category should be by now. */
  paceTarget: number
  /**
   * True when a discrete bill is what this category's plan is for. Its unspent
   * plan is money already spoken for, not slack — offering to move an unpaid
   * rent to cover a restaurant is the one suggestion this screen must never make.
   */
  committed: boolean
  /** Set when this row is a planned event rather than a spending category. */
  eventId?: string
}

/** How many previous months a category's "usual" is averaged over. */
const TREND_MONTHS = 3

export interface DuplicatePair {
  /** The line typed by hand before any statement existed. */
  manual: Transaction
  /** The imported line that appears to be the same spend. */
  imported: Transaction
}

/**
 * Hand-logged spends that a later import appears to have brought in for real.
 * Both are sitting in the totals, so the month reads high by exactly the amount
 * of every pair here until one of them goes.
 *
 * Matched on date and amount alone: a typed "lunch" never resembles a card
 * statement's merchant string, so requiring the descriptions to agree would
 * find nothing.
 *
 * Plan lines are deliberately not in here. A budget pocket the month assumed
 * settled is not a transaction competing with the statement — the moment a real
 * charge answers to the line, the pocket is filled by the charge and the
 * assumption stops counting on its own. There is nothing to ask about and
 * nothing to delete.
 */
export function duplicatePairs(data: AppData, month: string): DuplicatePair[] {
  const monthTxs = data.transactions.filter((t) => t.month === month && !NON_CASHFLOW.has(t.category))
  const imported = monthTxs.filter((t) => t.source !== 'manual')
  const claimed = new Set<string>()
  const out: DuplicatePair[] = []
  for (const manual of monthTxs) {
    if (manual.source !== 'manual' || manual.notDuplicate) continue
    const hit = imported.find(
      (t) => !claimed.has(t.id) && t.date === manual.date && Math.abs(t.amount - manual.amount) < 0.005,
    )
    if (hit) {
      claimed.add(hit.id)
      out.push({ manual, imported: hit })
    }
  }
  return out
}

/** The key one month's assumption about one plan line is stored under. */
export function assumptionKey(month: string, lineId: string): string {
  return `${month}:${lineId}`
}

export interface AssumedBill {
  id: string
  label: string
  category: string
  /** What is actually being counted — the plan's figure, or a correction. */
  amount: number
  /** What the plan says, so a correction can say what it corrected. */
  planAmount: number
  /** The day of the month it usually lands. */
  day: number
  /**
   * True when the month assumed it without being asked, because it is a loan,
   * a utility, an insurance premium or a subscription; false when it was
   * marked as paid by hand.
   */
  auto: boolean
}

/**
 * Whether this month counts a plan line as settled, and at what.
 *
 * Fixed costs are assumed by default — they leave whether or not anyone
 * remembers them — and everything else only once it has been marked as paid.
 * Either way the answer is a note against the budget pocket, never a
 * transaction, and either way a real charge that answers to the line overrides
 * it: `computeMonthPulse` checks arrival first and never asks this about a line
 * that has landed, so the two can't both count.
 */
export function assumedAmountFor(
  data: AppData,
  item: RecurringItem,
  planAmount: number,
  month: string,
): number | null {
  const key = assumptionKey(month, item.id)
  const marked = data.assumedPaid?.[key]
  if (marked !== undefined) return round2(marked)
  if (!FIXED_COST_CATEGORIES.has(item.category)) return null
  if ((data.autoPaySkips ?? []).includes(key)) return null
  return round2(planAmount)
}

export interface MonthPulse {
  month: string
  daysElapsed: number
  daysTotal: number
  daysLeft: number
  /** Money in so far, and what the plan still expects to arrive. */
  incomeSoFar: number
  incomeExpected: number
  /**
   * Ordinary spending so far — set-aside and provision-funded bills excluded,
   * assumed bills included. This screen's job is to say where the month stands
   * right now, and a rent that certainly left on the 3rd is part of that
   * whether or not the statement has arrived; `assumedTotal` says how much of
   * this is taken on trust.
   */
  spent: number
  plannedSpend: number
  /**
   * What the month lands at if the plan holds: spent so far plus everything
   * still expected. The figure to judge the month by — a linear extrapolation
   * of spending to date says a month is running cheap right up until the rent
   * posts.
   */
  projectedMonthEnd: number
  /**
   * Day-to-day spending only, with the committed bills taken out of both sides.
   * Pace is a fair question of groceries and dinners, which really do spread
   * across the month; asking it of a rent that lands whole on the 3rd tells you
   * nothing except which side of the 3rd you are on.
   */
  everydaySpent: number
  everydayPlan: number
  /** Where `everydaySpent` should be by this day of the month. */
  everydayPaceTarget: number
  /** Month-end everyday spending at the current daily rate. */
  everydayPaceMonthEnd: number
  /** Committed bills that haven't shown up yet, soonest first. */
  pending: PendingBill[]
  pendingTotal: number
  /**
   * Pockets this month counts as settled without a statement — the fixed costs
   * it assumes, plus anything marked as paid by hand. Counted in `spent` and in
   * their category's actual, and listed separately so what is a guess is never
   * silently mixed in with what was observed.
   */
  assumed: AssumedBill[]
  assumedTotal: number
  /**
   * Plan lines that cost nothing this month but land in a later one — an annual
   * premium, a quarterly tax. Deliberately absent from every figure here: this
   * month does not owe them, and budgeting a €900 premium in each of the twelve
   * months it is not due would be nonsense. Listed only so the answer to "where
   * is my insurance?" is on the screen rather than a puzzle.
   */
  upcoming: UpcomingBill[]
  /**
   * Everything the plan still expects to go out this month: each category's
   * plan less what it has already spent. Wider than `pendingTotal`, which only
   * names the discrete bills — this also carries the unspent half of a
   * variable budget, money that is every bit as spoken for.
   */
  committedLeft: number
  setAside: number
  plannedSetAside: number
  /** Set-aside the plan still expects this month. */
  setAsideLeft: number
  /**
   * What is genuinely free once everything known is accounted for: money in
   * (arrived and still expected), less what has gone out, less the bills still
   * to land, less the pots still to be filled. The figure behind "can I spend".
   */
  freeToSpend: number
  categories: CategoryPulse[]
  duplicates: DuplicatePair[]
  /** Hand-logged lines this month, newest first. */
  manualTxs: Transaction[]
  transactionCount: number
}

export function computeMonthPulse(data: AppData, month = currentMonth(), today = todayISO()): MonthPulse {
  const review = computeReview(data, month)
  const { elapsed, total } = monthProgress(month, today)
  const monthTxs = data.transactions.filter((t) => t.month === month)

  // Bills the plan carries for this month that nothing has matched yet.
  //
  // Only the committed ones: a variable budget like groceries is €400 of many
  // small shops, never a single €400 line, so looking for one would report it
  // as still to come all month however much had already been spent. What is
  // left of a budget like that is simply its plan less its actuals, which is
  // what `committedLeft` below counts and what the category table already says.
  const pending: PendingBill[] = []
  const assumed: AssumedBill[] = []
  // Assumed spending per category, so a pocket the month takes on trust fills
  // its own budget line and nobody else's.
  const assumedByCat: Record<string, number> = {}
  // Both sides of the committed half of the month, so pace can be asked of the
  // everyday half alone.
  let discretePlan = 0
  let discreteArrived = 0
  const committedCats = new Set<string>()
  const claimedCharges = new Set<string>()
  for (const item of data.recurring) {
    if (item.flow !== 'expense' || NON_CASHFLOW.has(item.category) || isPlannedSetAside(item)) continue
    const amount = itemAmountForMonth(item, month)
    if (amount <= 0.5) continue
    if (!looksDiscrete(data, item, amount, month)) continue
    committedCats.add(item.category)
    discretePlan += amount
    const takenOnTrust = assumedAmountFor(data, item, amount, month)
    // Reality first, always. A charge that answers to this line fills the
    // pocket, and whatever the month was assuming about it stops counting —
    // which is why an assumption can never double up with the statement that
    // supersedes it, and why there is nothing to reconcile away.
    const arrived = arrivedCharge(item, amount, monthTxs, takenOnTrust, claimedCharges)
    if (arrived) {
      claimedCharges.add(arrived.id)
      // What it really cost, not what the plan hoped. Taking the plan's figure
      // out of the everyday half would leave the overshoot in it, and read a
      // dear electricity bill as an evening out.
      discreteArrived += arrived.amount
      continue
    }
    const typicalDay = typicalDayFor(data, item, amount, month)
    if (takenOnTrust !== null && takenOnTrust > 0.005) {
      discreteArrived += takenOnTrust
      assumedByCat[item.category] = round2((assumedByCat[item.category] ?? 0) + takenOnTrust)
      assumed.push({
        id: item.id,
        label: item.label,
        category: item.category,
        amount: takenOnTrust,
        planAmount: round2(amount),
        day: typicalDay,
        auto: data.assumedPaid?.[assumptionKey(month, item.id)] === undefined,
      })
      continue
    }
    pending.push({
      id: item.id,
      label: item.label,
      category: item.category,
      amount: round2(amount),
      typicalDay,
      overdue: elapsed > 0 && typicalDay < elapsed,
      unassumed: FIXED_COST_CATEGORIES.has(item.category),
    })
  }
  pending.sort((a, b) => a.typicalDay - b.typicalDay || b.amount - a.amount)
  assumed.sort((a, b) => a.day - b.day || b.amount - a.amount)
  const pendingTotal = round2(pending.reduce((s, p) => s + p.amount, 0))
  const assumedTotal = round2(assumed.reduce((s, a) => s + a.amount, 0))

  // Costs the plan carries that simply are not due this month.
  const upcoming: UpcomingBill[] = []
  for (const item of data.recurring) {
    if (item.flow !== 'expense' || NON_CASHFLOW.has(item.category) || isPlannedSetAside(item)) continue
    if (itemAmountForMonth(item, month) > 0.5) continue
    const date = nextOccurrence(item, addMonths(month, 1))
    if (!date) continue
    // Beyond half a year it stops being useful context and starts being a list.
    if (date.slice(0, 7) > addMonths(month, 6)) continue
    upcoming.push({
      id: item.id,
      label: item.label,
      category: item.category,
      amount: round2(itemAmountForMonth(item, date.slice(0, 7))),
      month: date.slice(0, 7),
      date,
    })
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)

  // Income still to arrive, on the same "has it shown up yet" footing.
  let incomeExpected = 0
  for (const item of data.recurring) {
    if (item.flow !== 'income' || NON_CASHFLOW.has(item.category)) continue
    const amount = itemAmountForMonth(item, month)
    if (amount <= 0.5) continue
    const arrived = monthTxs.some(
      (t) => t.amount > 0 && t.category === item.category && Math.abs(t.amount - amount) <= Math.max(2, amount * 0.15),
    )
    if (!arrived) incomeExpected += amount
  }
  incomeExpected = round2(incomeExpected)

  // Each category's recent norm, so this month can be read against habit as
  // well as against plan — a plan line that was never realistic and a genuine
  // change in behaviour look identical without it.
  const prevMonths: string[] = []
  for (let i = 1; i <= TREND_MONTHS; i++) prevMonths.push(addMonths(month, -i))
  const withData = prevMonths.filter((m) => data.transactions.some((t) => t.month === m))
  const past = withData.length ? actualsByCategoryRange(data, withData, { splitSavings: true }) : null

  const categories: CategoryPulse[] = review.categories
    .filter((c) => c.flow === 'expense')
    .map((c) => {
      const average = past && withData.length ? round2((past.expense[c.category] ?? 0) / withData.length) : 0
      const paceTarget = total > 0 ? round2((c.planned * elapsed) / total) : 0
      // An event row is keyed by the event, not the category, and a pocket
      // taken on trust belongs to the ordinary category line.
      const actual = round2(c.actual + (c.eventId ? 0 : (assumedByCat[c.category] ?? 0)))
      return {
        category: c.category,
        planned: round2(c.planned),
        actual,
        left: round2(Math.max(0, c.planned - actual)),
        over: round2(Math.max(0, actual - c.planned)),
        average,
        vsAverage: round2(actual - average),
        paceTarget,
        // An event is a lump with dates, not a habit to pace — treated as
        // committed so its unspent budget never reads as everyday slack.
        committed: !!c.eventId || committedCats.has(c.category),
        ...(c.eventId ? { eventId: c.eventId } : {}),
      }
    })
    .sort((a, b) => b.actual - a.actual)

  const setAsideLeft = round2(Math.max(0, review.plannedSetAside - review.setAside))
  // What the plan still expects to leave the account, taken per category so a
  // bill already paid can't be counted as still coming and an overspent
  // category can't lend its excess back.
  const committedLeft = round2(categories.reduce((s, c) => s + c.left, 0))
  // Events come out of both sides of the pace question too: three days of a
  // trip is not a habit, and leaving it in would swamp the one measure that
  // says whether ordinary spending is under control.
  const eventRows = categories.filter((c) => c.eventId)
  const eventPlan = round2(eventRows.reduce((s, c) => s + c.planned, 0))
  const eventSpent = round2(eventRows.reduce((s, c) => s + c.actual, 0))
  const spent = round2(review.expenses + assumedTotal)
  // Assumptions are only ever made about discrete bills, and every one of them
  // is already inside `discreteArrived` — so the everyday half is untouched by
  // them, which is the point: pace is a question about habits.
  const everydaySpent = round2(Math.max(0, spent - discreteArrived - eventSpent))
  const everydayPlan = round2(Math.max(0, review.plannedExpenses - discretePlan - eventPlan))
  const everydayRate = elapsed > 0 ? everydaySpent / elapsed : 0

  return {
    month,
    daysElapsed: elapsed,
    daysTotal: total,
    daysLeft: Math.max(0, total - elapsed),
    incomeSoFar: review.income,
    incomeExpected,
    spent,
    plannedSpend: review.plannedExpenses,
    projectedMonthEnd: round2(spent + committedLeft),
    everydaySpent,
    everydayPlan,
    everydayPaceTarget: total > 0 ? round2((everydayPlan * elapsed) / total) : 0,
    everydayPaceMonthEnd: round2(everydayRate * total),
    pending,
    pendingTotal,
    assumed,
    assumedTotal,
    upcoming,
    committedLeft,
    setAside: review.setAside,
    plannedSetAside: review.plannedSetAside,
    setAsideLeft,
    freeToSpend: round2(
      review.income + incomeExpected - spent - committedLeft - review.setAside - setAsideLeft,
    ),
    categories,
    duplicates: duplicatePairs(data, month),
    manualTxs: monthTxs.filter((t) => t.source === 'manual').sort((a, b) => b.date.localeCompare(a.date)),
    transactionCount: monthTxs.length,
  }
}

/**
 * The month in progress, written for the assistant. Deliberately spells out
 * what is still to come and where each category stands against both plan and
 * habit, because the question this gets asked is "can I afford X" — which is
 * unanswerable from a spend-to-date total alone.
 */
export function monthPulseText(data: AppData, month = currentMonth()): string {
  const { currency, locale } = data.settings
  const fx = (n: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  const p = computeMonthPulse(data, month)
  const lines: string[] = []

  lines.push(
    `Current month (${month}), day ${p.daysElapsed} of ${p.daysTotal}, ${p.daysLeft} days left. ` +
      `Money in so far ${fx(p.incomeSoFar)}${p.incomeExpected > 0.5 ? ` (a further ${fx(p.incomeExpected)} still expected)` : ''}. ` +
      `Ordinary spending so far ${fx(p.spent)} against ${fx(p.plannedSpend)} planned for the whole month. ` +
      `If the plan holds the month lands at ${fx(p.projectedMonthEnd)}` +
      (Math.abs(p.projectedMonthEnd - p.plannedSpend) < 1
        ? ', exactly on plan.'
        : ` — ${fx(Math.abs(p.projectedMonthEnd - p.plannedSpend))} ${p.projectedMonthEnd > p.plannedSpend ? 'over' : 'under'} plan.`),
  )
  lines.push(
    `Day-to-day spending (the committed bills taken out of both sides) is ${fx(p.everydaySpent)} of ${fx(p.everydayPlan)} ` +
      `budgeted, where even pacing would put it near ${fx(p.everydayPaceTarget)} by now; at this daily rate it ends the ` +
      `month around ${fx(p.everydayPaceMonthEnd)}. Judge day-to-day habits on these figures, not on the totals above, ` +
      'which move with whether a big bill happens to have posted yet.',
  )
  if (p.setAside > 0.5 || p.plannedSetAside > 0.5) {
    lines.push(
      `Set aside so far ${fx(p.setAside)} of ${fx(p.plannedSetAside)} planned` +
        (p.setAsideLeft > 0.5 ? `, so ${fx(p.setAsideLeft)} still to move into pots this month.` : '.'),
    )
  }

  lines.push(
    `The plan still expects ${fx(p.committedLeft)} to go out this month: every category's plan less what it has ` +
      'already spent. That covers both the bills below and the unspent half of the variable budgets.',
  )
  if (p.assumed.length) {
    lines.push(
      `Of the spending above, ${fx(p.assumedTotal)} is taken on trust rather than seen on a statement: ` +
        p.assumed
          .map((a) => `${a.label} ${fx(a.amount)} [${a.category}, around day ${a.day}]`)
          .join('; ') +
        '. These are budget pockets the month counts as filled because the bills always go out; if the ' +
        'real charge turns up for a different amount, the charge replaces the assumption rather than ' +
        'adding to it.',
    )
  }

  if (p.pending.length) {
    lines.push(
      `Committed bills nothing has matched yet, ${fx(p.pendingTotal)} of that total: ` +
        p.pending
          .map(
            (b) =>
              `${b.label} ${fx(b.amount)} [${b.category}] usually around day ${b.typicalDay}` +
              (b.overdue ? ' — that day has passed, so it is overdue or already paid under another label' : ''),
          )
          .join('; ') +
        '.',
    )
  } else {
    lines.push('Every committed bill for this month has already shown up — only variable budgets are left to spend.')
  }

  if (p.upcoming.length) {
    lines.push(
      'Planned costs not due this month, so deliberately in none of the figures above: ' +
        p.upcoming.map((b) => `${b.label} ${fx(b.amount)} [${b.category}] lands ${b.month}`).join('; ') +
        '. Worth raising if the user is deciding what they can afford and one of these is close.',
    )
  }
  lines.push(
    `Free to spend: ${fx(p.freeToSpend)}. That is money in (arrived plus still expected) less what has gone out, ` +
      'less everything the plan still expects to go out, less the pots still to be filled. When asked whether something is affordable, ' +
      'reason from this figure and from the category budgets below — not from the account balance, which still holds ' +
      "money committed to this month's remaining bills.",
  )

  if (p.categories.length) {
    const events = p.categories.filter((c) => c.eventId)
    if (events.length) {
      lines.push(
        'Planned events running this month, each carrying its share of its own budget for the days it runs ' +
          '(a trip over a month end is split between both months, not charged whole to either). Spending tagged ' +
          'to an event is counted here instead of under Dining or Travel, so it appears once: ' +
          events
            .map(
              (c) =>
                `${c.category} ${fx(c.actual)} spent of ${fx(c.planned)} budgeted here` +
                (c.over > 0.5 ? ` (${fx(c.over)} OVER)` : ` (${fx(c.left)} left)`),
            )
            .join('; ') +
          '.',
      )
    }
    lines.push(
      'By category this month (spent / planned / left · usual monthly average): ' +
        p.categories
          .slice(0, 12)
          .map(
            (c) =>
              `${c.category} ${fx(c.actual)}/${fx(c.planned)}` +
              (c.over > 0.5 ? ` (${fx(c.over)} OVER)` : ` (${fx(c.left)} left)`) +
              (c.average > 0.5 ? ` · usually ${fx(c.average)}` : ''),
          )
          .join('; ') +
        '.',
    )
    const headroom = p.categories.filter((c) => !c.committed && c.left > 5 && c.actual < c.paceTarget - 5)
    if (headroom.length) {
      lines.push(
        'Running behind plan (money that could be moved to cover an overspend elsewhere, if the user agrees): ' +
          headroom.map((c) => `${c.category} ${fx(c.left)} unspent`).join(', ') +
          '. Suggest a specific reallocation rather than a flat no when a category is short but the month overall is not.',
      )
    }
  }

  if (p.duplicates.length) {
    lines.push(
      `${p.duplicates.length} hand-logged spend(s) look like they were also imported from a statement, so the ` +
        'totals above are overstated by that much until the user resolves them on the Current month screen.',
    )
  }
  return lines.join('\n')
}
