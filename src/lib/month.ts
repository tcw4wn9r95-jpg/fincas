import type { AppData, RecurringItem, Transaction } from './types'
import {
  computeReview,
  isPlannedSetAside,
  isVariableExpense,
  itemAmountForMonth,
  actualsByCategoryRange,
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
}

/**
 * A recurring line counts as arrived when a transaction this month sits in its
 * category at roughly its size. Roughly, because a bill that moves by a few
 * euros month to month (a utility, a variable-rate loan) is still that bill —
 * demanding an exact match would report every one of them as still to come and
 * make "what is left" read far too pessimistic.
 */
function lineHasArrived(item: RecurringItem, amount: number, monthTxs: Transaction[]): boolean {
  const tol = Math.max(2, amount * 0.15)
  return monthTxs.some(
    (t) => t.amount < 0 && t.category === item.category && Math.abs(Math.abs(t.amount) - amount) <= tol,
  )
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
 * Whether a plan line is the kind that lands as one identifiable charge — a
 * rent, a loan, an insurance premium — as opposed to a budget spread over many
 * small ones.
 *
 * Decided from history rather than from the category, because the planner's
 * fixed/variable split is about pacing discretionary spend and gets this wrong
 * in both directions: rent sits in Housing, which nothing marks as fixed unless
 * the user happens to have grouped it that way. If a month has gone by with a
 * single charge of about this size in this category, it is a bill. With no
 * history to go on at all, fall back to the planner's own split.
 */
function looksDiscrete(data: AppData, item: RecurringItem, amount: number, month: string): boolean {
  if (historyDays(data, item, amount, month).length > 0) return true
  const seenCategory = data.transactions.some(
    (t) => t.month < month && t.category === item.category && t.amount < 0,
  )
  return seenCategory ? false : !isVariableExpense(item)
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
}

/** How many previous months a category's "usual" is averaged over. */
const TREND_MONTHS = 3

export interface DuplicatePair {
  /** The line logged by hand, before the statement arrived. */
  manual: Transaction
  /** The imported line that appears to be the same spend. */
  imported: Transaction
}

/**
 * Spends logged by hand that a later import appears to have brought in again:
 * same day, same amount, one typed and one from a file. Both are sitting in the
 * totals, so the month reads high by exactly the amount of every pair here
 * until one of them is dropped — which is why this is surfaced rather than
 * quietly resolved. Matched on date and amount alone: a hand-typed "lunch"
 * never resembles a card statement's merchant string, so requiring the
 * descriptions to agree would find nothing.
 */
export function duplicatePairs(data: AppData, month: string): DuplicatePair[] {
  const monthTxs = data.transactions.filter((t) => t.month === month && !NON_CASHFLOW.has(t.category))
  const imported = monthTxs.filter((t) => t.source !== 'manual')
  const claimed = new Set<string>()
  const out: DuplicatePair[] = []
  for (const manual of monthTxs) {
    if (manual.source !== 'manual') continue
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

export interface MonthPulse {
  month: string
  daysElapsed: number
  daysTotal: number
  daysLeft: number
  /** Money in so far, and what the plan still expects to arrive. */
  incomeSoFar: number
  incomeExpected: number
  /** Ordinary spending so far — set-aside and provision-funded bills excluded. */
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
  // Both sides of the committed half of the month, so pace can be asked of the
  // everyday half alone.
  let discretePlan = 0
  let discreteArrived = 0
  const committedCats = new Set<string>()
  for (const item of data.recurring) {
    if (item.flow !== 'expense' || NON_CASHFLOW.has(item.category) || isPlannedSetAside(item)) continue
    const amount = itemAmountForMonth(item, month)
    if (amount <= 0.5) continue
    if (!looksDiscrete(data, item, amount, month)) continue
    committedCats.add(item.category)
    discretePlan += amount
    if (lineHasArrived(item, amount, monthTxs)) {
      discreteArrived += amount
      continue
    }
    const typicalDay = typicalDayFor(data, item, amount, month)
    pending.push({
      id: item.id,
      label: item.label,
      category: item.category,
      amount: round2(amount),
      typicalDay,
      overdue: elapsed > 0 && typicalDay < elapsed,
    })
  }
  pending.sort((a, b) => a.typicalDay - b.typicalDay || b.amount - a.amount)
  const pendingTotal = round2(pending.reduce((s, p) => s + p.amount, 0))

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
      return {
        category: c.category,
        planned: round2(c.planned),
        actual: round2(c.actual),
        left: round2(Math.max(0, c.planned - c.actual)),
        over: round2(Math.max(0, c.actual - c.planned)),
        average,
        vsAverage: round2(c.actual - average),
        paceTarget,
        committed: committedCats.has(c.category),
      }
    })
    .sort((a, b) => b.actual - a.actual)

  const setAsideLeft = round2(Math.max(0, review.plannedSetAside - review.setAside))
  // What the plan still expects to leave the account, taken per category so a
  // bill already paid can't be counted as still coming and an overspent
  // category can't lend its excess back.
  const committedLeft = round2(categories.reduce((s, c) => s + c.left, 0))
  const everydaySpent = round2(Math.max(0, review.expenses - discreteArrived))
  const everydayPlan = round2(Math.max(0, review.plannedExpenses - discretePlan))
  const everydayRate = elapsed > 0 ? everydaySpent / elapsed : 0

  return {
    month,
    daysElapsed: elapsed,
    daysTotal: total,
    daysLeft: Math.max(0, total - elapsed),
    incomeSoFar: review.income,
    incomeExpected,
    spent: review.expenses,
    plannedSpend: review.plannedExpenses,
    projectedMonthEnd: round2(review.expenses + committedLeft),
    everydaySpent,
    everydayPlan,
    everydayPaceTarget: total > 0 ? round2((everydayPlan * elapsed) / total) : 0,
    everydayPaceMonthEnd: round2(everydayRate * total),
    pending,
    pendingTotal,
    committedLeft,
    setAside: review.setAside,
    plannedSetAside: review.plannedSetAside,
    setAsideLeft,
    freeToSpend: round2(
      review.income + incomeExpected - review.expenses - committedLeft - review.setAside - setAsideLeft,
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

  lines.push(
    `Free to spend: ${fx(p.freeToSpend)}. That is money in (arrived plus still expected) less what has gone out, ` +
      'less everything the plan still expects to go out, less the pots still to be filled. When asked whether something is affordable, ' +
      'reason from this figure and from the category budgets below — not from the account balance, which still holds ' +
      "money committed to this month's remaining bills.",
  )

  if (p.categories.length) {
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
