import type {
  AppData,
  RecurringItem,
  ForecastPoint,
  MonthReview,
  CategoryActual,
  Scenario,
} from './types'
import { currentMonth, monthRange, shortMonth, addMonths, uid, todayISO } from './format'
import {
  provisionCoveredByCategoryRange,
  allProvisionStatuses,
  emergencyFundStatus,
  setAsideAmount,
} from './provisions'
import { allEventStatuses, eventSummaryLine } from './events'
import { fundingPlan } from './funding'
import { NON_CASHFLOW, SAVINGS_CATEGORY } from './categorize'

const round2 = (n: number) => Math.round(n * 100) / 100

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

// Which planner section a line belongs to. An explicit `group` wins; otherwise
// we infer it from the category. Used for subtotals and the fixed/variable split.
// Entertainment is deliberately NOT here: it's discretionary, day-to-day
// spending that should be paced by the weekly check-in like any other
// variable category, not treated as a committed fixed cost.
const FIXED_CATS = new Set(['Loans', 'Utilities', 'Insurance', 'Subscriptions'])
const PROVISION_CATS = new Set(['Taxes', 'Provisions', 'Travel'])

export function planSection(item: RecurringItem): string {
  if (item.group) return item.group
  if (item.flow === 'income') return 'Income'
  if (FIXED_CATS.has(item.category)) return 'Fixed monthly'
  if (PROVISION_CATS.has(item.category)) return 'Provisions'
  return 'Variable'
}

/**
 * A plan line that puts money aside rather than spending it: the planner's
 * Provisions section, and plain savings. These are compared against what was
 * actually set aside, never against spending.
 */
export function isPlannedSetAside(item: RecurringItem): boolean {
  return (
    item.flow === 'expense' &&
    (item.category === SAVINGS_CATEGORY || planSection(item) === 'Provisions')
  )
}

/** Variable = the "Variable" section (everything after Imprevistos); else fixed. */
export function isVariableExpense(item: RecurringItem): boolean {
  return item.flow === 'expense' && planSection(item) === 'Variable'
}

/** Planned variable spend for a month — the budget the weekly check-in paces against. */
export function variablePlanForMonth(data: AppData, month: string): number {
  return data.recurring
    .filter(isVariableExpense)
    .reduce((s, it) => s + itemAmountForMonth(it, month), 0)
}

/**
 * What a line's cadence and base amount alone imply for a month, ignoring any
 * explicit per-month value. Lets the planner tell a genuine override apart
 * from a stored value that merely restates the cadence — editing a cell in the
 * old grid wrote one of those for every month, so most are redundant.
 */
export function itemBaseAmountForMonth(item: RecurringItem, month: string): number {
  const startMonth = item.startDate.slice(0, 7)
  if (month < startMonth) return 0
  if (item.endDate && month >= item.endDate.slice(0, 7)) return 0

  const since = monthsBetween(startMonth, month)
  switch (item.cadence) {
    case 'monthly':
      return item.amount
    case 'weekly':
      return (item.amount * 52) / 12
    case 'biweekly':
      return (item.amount * 26) / 12
    case 'quarterly':
      return since % 3 === 0 ? item.amount : 0
    case 'annual':
      return since % 12 === 0 ? item.amount : 0
    case 'one-time':
      return month === startMonth ? item.amount : 0
    default:
      return 0
  }
}

/** How much a recurring item contributes during a given YYYY-MM. */
export function itemAmountForMonth(item: RecurringItem, month: string): number {
  // An explicit per-month value always wins — this is what makes the plan precise.
  if (item.monthly && Object.prototype.hasOwnProperty.call(item.monthly, month)) {
    const v = item.monthly[month]
    if (typeof v === 'number' && !Number.isNaN(v)) return v
  }
  return itemBaseAmountForMonth(item, month)
}

export function totalBalance(data: AppData): number {
  return data.accounts.reduce((sum, a) => sum + a.balance, 0)
}

/**
 * The month the recorded balances are anchored to (the latest `asOf` month).
 * An account balance is treated as the balance at the *start* of this month.
 */
export function anchorMonth(data: AppData): string {
  let m = ''
  for (const a of data.accounts) {
    const am = (a.asOf || '').slice(0, 7)
    if (am && am > m) m = am
  }
  return m || currentMonth()
}

/**
 * Self-anchoring balance: the known balance rolled forward (or back) through
 * the plan to the start of the current month. This keeps the forecast's
 * starting point current as real months pass, with no need to re-import.
 * Once a past month's plan has been matched to actuals, that roll uses the
 * real figures — so the forecast tracks reality.
 */
export function startingBalance(data: AppData): number {
  const now = currentMonth()
  const anchor = anchorMonth(data)
  let bal = totalBalance(data)
  let m = anchor
  while (m < now) {
    const { income, expenses } = plannedFlowsForMonth(data, m)
    bal += income - expenses
    m = addMonths(m, 1)
  }
  while (m > now) {
    m = addMonths(m, -1)
    const { income, expenses } = plannedFlowsForMonth(data, m)
    bal -= income - expenses
  }
  return bal
}

// Defined with the categories themselves (and re-exported here, where most
// callers already look for it) so modules can exclude transfers without
// pulling in the whole forecast.
export { NON_CASHFLOW }

/**
 * A label for money released from a provision to cover a bill that landed this
 * month — used by the Sankey's shortfall split, which draws the pots as a
 * visible source of cash. `actualsByCategoryRange` deliberately keeps such
 * spending in its category so that diagram (and plan-matching) still see it;
 * only `computeReview`'s totals take it out, where charging it twice would make
 * a provisioned bill sink the month it lands in.
 */
export const PROVISIONED_BRACKET = 'Provisioned'

/**
 * Actual money in/out per category across a set of months. Positives and
 * negatives inside the same category are netted first (a Health spend minus
 * its reimbursement shows as the net spend), then the net lands on the in or
 * out side by its sign.
 */
export function actualsByCategoryRange(
  data: AppData,
  months: string[],
  opts: { splitSavings?: boolean } = {},
): { income: Record<string, number>; expense: Record<string, number>; setAside: number } {
  const monthSet = new Set(months)
  const net: Record<string, number> = {}
  let setAside = 0
  for (const t of data.transactions) {
    if (!monthSet.has(t.month)) continue
    if (NON_CASHFLOW.has(t.category)) continue
    const aside = setAsideAmount(t)
    setAside += aside
    // Off the category only when the caller is reporting savings separately.
    // Plan-matching still wants a Savings line to compare against its budget.
    net[t.category] = (net[t.category] ?? 0) + t.amount + (opts.splitSavings ? aside : 0)
  }
  const income: Record<string, number> = {}
  const expense: Record<string, number> = {}
  for (const [cat, n] of Object.entries(net)) {
    const r = round2(n)
    if (r > 0) income[cat] = r
    else if (r < 0) expense[cat] = -r
  }
  return { income, expense, setAside: round2(setAside) }
}

/** Actual money in/out per category for a single month — see `actualsByCategoryRange`. */
export function actualsByCategory(
  data: AppData,
  month: string,
  opts: { splitSavings?: boolean } = {},
): { income: Record<string, number>; expense: Record<string, number>; setAside: number } {
  return actualsByCategoryRange(data, [month], opts)
}

/** The latest month the plan reaches — explicit monthly values or a finite end date. */
export function lastPlanMonth(data: AppData): string {
  let last = ''
  for (const item of data.recurring) {
    if (item.monthly) {
      for (const m of Object.keys(item.monthly)) {
        if (m > last) last = m
      }
    }
    // A finite end date extends the visible horizon so the whole run shows.
    if (item.endDate) {
      const em = addMonths(item.endDate.slice(0, 7), -1)
      if (em > last) last = em
    }
  }
  return last
}

/** How many months the forecast should span: through the end of the plan. */
export function forecastHorizon(data: AppData): number {
  const last = lastPlanMonth(data)
  if (!last) return 12
  const span = monthsBetween(currentMonth(), last) + 1
  return Math.min(36, Math.max(12, span))
}

/** The forward months the planner/forecast covers (current month → end of plan). */
export function planMonths(data: AppData): string[] {
  return monthRange(currentMonth(), forecastHorizon(data))
}

function plannedFlowsForMonth(data: AppData, month: string) {
  let income = 0
  let fixed = 0
  let variable = 0
  for (const item of data.recurring) {
    const amt = itemAmountForMonth(item, month)
    if (item.flow === 'income') income += amt
    else if (isVariableExpense(item)) variable += amt
    else fixed += amt
  }
  return { income, expenses: fixed + variable, fixed, variable }
}

/**
 * Projects total balance forward `count` months starting from the current
 * month, using the user's recurring income/expenses as the plan.
 */
export function buildForecast(data: AppData, count = 12): ForecastPoint[] {
  const start = currentMonth()
  const months = monthRange(start, count)
  let running = startingBalance(data)
  const out: ForecastPoint[] = []
  for (const month of months) {
    const { income, expenses, fixed, variable } = plannedFlowsForMonth(data, month)
    const net = income - expenses
    running += net
    out.push({
      month,
      label: shortMonth(month, data.settings.locale),
      income,
      expenses,
      fixedExpenses: fixed,
      variableExpenses: variable,
      net,
      balance: running,
      projected: month > start,
    })
  }
  return out
}

/** Category-based fixed/variable split for actual transactions (no plan line to ask). */
function expenseCategoryIsVariable(category: string): boolean {
  return !FIXED_CATS.has(category) && !PROVISION_CATS.has(category)
}

export interface LedgerPoint extends ForecastPoint {
  /** True where the row's figures come from imported actuals, not the plan. */
  actual: boolean
}

/**
 * A month-by-month ledger from the earliest money-dated month through the end of
 * the forecast: past months use real imported figures, current and future months
 * use the plan. Balances roll continuously so the actual past flows straight into
 * the projected future, meeting the current balance at "now".
 */
export function buildLedger(data: AppData): LedgerPoint[] {
  const now = currentMonth()
  const locale = data.settings.locale
  const horizon = monthRange(now, forecastHorizon(data))
  const lastMonth = horizon[horizon.length - 1]
  const withData = new Set(monthsWithData(data))
  const earliestPast = monthsWithData(data)
    .filter((m) => m < now)
    .sort()[0]
  const start = earliestPast && earliestPast < now ? earliestPast : now

  // Build the contiguous month span.
  const months: string[] = []
  for (let m = start; m <= lastMonth; m = addMonths(m, 1)) months.push(m)

  // Per-month figures: real actuals for past months that have data, else the plan.
  const rows = months.map((month) => {
    if (month < now && withData.has(month)) {
      const { income, expense } = actualsByCategory(data, month)
      const inc = Object.values(income).reduce((a, b) => a + b, 0)
      let fixed = 0
      let variable = 0
      for (const [cat, amt] of Object.entries(expense)) {
        if (expenseCategoryIsVariable(cat)) variable += amt
        else fixed += amt
      }
      return { month, income: inc, fixed, variable, expenses: fixed + variable, net: inc - (fixed + variable), actual: true }
    }
    const { income, fixed, variable, expenses } = plannedFlowsForMonth(data, month)
    return { month, income, fixed, variable, expenses, net: income - expenses, actual: false }
  })

  // Anchor: startingBalance is the balance at the start of `now`. Roll back over
  // the shown past months so the running total lands exactly there.
  const netBeforeNow = rows.filter((r) => r.month < now).reduce((s, r) => s + r.net, 0)
  let running = startingBalance(data) - netBeforeNow
  return rows.map((r) => {
    running += r.net
    return {
      month: r.month,
      label: shortMonth(r.month, locale),
      income: r.income,
      expenses: r.expenses,
      fixedExpenses: r.fixed,
      variableExpenses: r.variable,
      net: r.net,
      balance: running,
      projected: r.month > now,
      actual: r.actual,
    }
  })
}

// ── Scenarios ─────────────────────────────────────────────────────

/** Find a scenario by id (usually the active one). */
export function activeScenario(data: AppData): Scenario | undefined {
  if (!data.activeScenarioId) return undefined
  return data.scenarios?.find((s) => s.id === data.activeScenarioId)
}

/**
 * Returns a copy of the plan with a scenario's adjustments baked in, so the
 * existing forecast engine can be re-run against it unchanged. Adjustments are
 * expressed as precise per-month overrides on the affected lines — the same
 * mechanism the planner uses — so nothing about the base engine has to know
 * scenarios exist. The real plan is never touched.
 */
export function applyScenario(base: AppData, scenario: Scenario): AppData {
  const data: AppData = structuredClone(base)
  const months = planMonths(base) // current month → end of plan
  const inRange = (m: string, from?: string, to?: string) =>
    (!from || m >= from) && (!to || m <= to)

  for (const adj of scenario.adjustments) {
    if (adj.op === 'add') {
      const from = adj.from || months[0]
      const monthly: Record<string, number> = {}
      for (const m of months) if (inRange(m, from, adj.to)) monthly[m] = adj.value ?? 0
      data.recurring.push({
        id: uid(),
        label: adj.newLine?.label || 'What-if line',
        amount: adj.value ?? 0,
        flow: adj.newLine?.flow || 'expense',
        cadence: 'monthly',
        category: adj.newLine?.category || 'Other',
        startDate: `${from}-01`,
        endDate: adj.to ? `${addMonths(adj.to, 1)}-01` : undefined,
        group: adj.newLine?.flow === 'income' ? 'Income' : undefined,
        monthly,
      })
      continue
    }
    const item = data.recurring.find((r) => r.id === adj.targetId)
    if (!item) continue
    // Read base values off the original item before we start overwriting.
    const next = { ...(item.monthly || {}) }
    for (const m of months) {
      if (!inRange(m, adj.from, adj.to)) continue
      const baseAmt = itemAmountForMonth(item, m)
      if (adj.op === 'pause') next[m] = 0
      else if (adj.op === 'set') next[m] = adj.value ?? 0
      else if (adj.op === 'scale') next[m] = round2(baseAmt * ((adj.value ?? 100) / 100))
    }
    item.monthly = next
  }
  return data
}

export interface ScenarioSummary {
  baseEnd: number
  scenarioEnd: number
  endDiff: number
  baseLow: number
  scenarioLow: number
  lowDiff: number
}

/** Baseline vs scenario end-of-plan balance and projected low, for the overlay caption. */
export function scenarioSummary(data: AppData, scenario: Scenario): ScenarioSummary {
  const count = forecastHorizon(data)
  const base = buildForecast(data, count)
  const scen = buildForecast(applyScenario(data, scenario), count)
  const end = (p: ForecastPoint[]) => (p.length ? p[p.length - 1].balance : 0)
  const low = (p: ForecastPoint[]) => p.reduce((m, x) => Math.min(m, x.balance), Infinity)
  const baseEnd = end(base)
  const scenarioEnd = end(scen)
  const baseLow = low(base)
  const scenarioLow = low(scen)
  return {
    baseEnd,
    scenarioEnd,
    endDiff: scenarioEnd - baseEnd,
    baseLow,
    scenarioLow,
    lowDiff: scenarioLow - baseLow,
  }
}

/** Months that actually have imported/added transactions, newest first. */
export function monthsWithData(data: AppData): string[] {
  const set = new Set(data.transactions.map((t) => t.month))
  return Array.from(set).sort().reverse()
}

export interface HistoryPoint {
  month: string
  label: string
  plannedNet: number
  actualNet: number
  plannedIn: number
  actualIn: number
  plannedOut: number
  actualOut: number
  /** Running actual net across the shown months — the real cash-flow track. */
  cumulativeActual: number
  cumulativePlanned: number
}

/**
 * The track record: for every month that has real transactions, the planned
 * cash flow (from the plan) against what actually happened (from imports).
 * Internal transfers are already excluded by computeReview.
 */
export function computeHistory(data: AppData): HistoryPoint[] {
  const months = monthsWithData(data).slice().sort()
  let cumA = 0
  let cumP = 0
  return months.map((m) => {
    const r = computeReview(data, m)
    cumA += r.net
    cumP += r.plannedNet
    return {
      month: m,
      label: shortMonth(m, data.settings.locale),
      plannedNet: r.plannedNet,
      actualNet: r.net,
      plannedIn: r.plannedIncome,
      actualIn: r.income,
      plannedOut: r.plannedExpenses,
      actualOut: r.expenses,
      cumulativeActual: cumA,
      cumulativePlanned: cumP,
    }
  })
}

/**
 * The "money date" review: actuals vs. plan for a single month, broken
 * down by category, so the user can see where they stand.
 */
export function computeReview(data: AppData, month: string): MonthReview {
  const txs = data.transactions.filter((t) => t.month === month)

  let income = 0
  let expenses = 0
  let setAside = 0
  let provisionedSpend = 0
  let excludedIn = 0
  let excludedOut = 0
  const actualIncomeByCat: Record<string, number> = {}
  const actualExpenseByCat: Record<string, number> = {}

  // Net positives and negatives within each category first, so a refund offsets
  // the spend it belongs to (e.g. a reimbursed Health cost shows its net).
  const netByCat: Record<string, number> = {}
  for (const t of txs) {
    // Internal moves between your own accounts don't count as income/spending.
    if (NON_CASHFLOW.has(t.category)) {
      if (t.amount >= 0) excludedIn += t.amount
      else excludedOut += Math.abs(t.amount)
      continue
    }
    // Money put into a pot is kept, not spent — it comes off this category
    // before anything is called an expense, and lands on its own line.
    const aside = setAsideAmount(t)
    setAside += aside
    netByCat[t.category] = (netByCat[t.category] ?? 0) + t.amount + aside
  }
  setAside = round2(setAside)

  // Bills a provision paid for, per category.
  const provisionCovered = provisionCoveredByCategoryRange(data, [month])

  for (const [cat, n] of Object.entries(netByCat)) {
    const net = round2(n)
    if (net > 0) {
      income += net
      actualIncomeByCat[cat] = net
    } else if (net < 0) {
      const gross = -net
      // The category row keeps the whole spend — a month that paid €3,600 of
      // tax must not read as having paid none — but the total leaves out the
      // part a pot covered. That cost was charged in the months that funded
      // the pot; charging it again on the day the bill lands is what made a
      // quarterly tax bill sink an otherwise ordinary month.
      const covered = Math.min(gross, round2(provisionCovered[cat] ?? 0))
      actualExpenseByCat[cat] = gross
      expenses += gross - covered
      provisionedSpend += covered
    }
  }
  expenses = round2(expenses)
  provisionedSpend = round2(provisionedSpend)

  // Planned figures from recurring items for this month.
  const plannedIncomeByCat: Record<string, number> = {}
  const recurringExpenseByCat: Record<string, number> = {}
  let plannedSetAside = 0
  for (const item of data.recurring) {
    if (NON_CASHFLOW.has(item.category)) continue
    const amt = itemAmountForMonth(item, month)
    if (amt === 0) continue
    if (item.flow === 'income') {
      plannedIncomeByCat[item.category] = (plannedIncomeByCat[item.category] ?? 0) + amt
      continue
    }
    // A provisioning line is money the plan puts aside each month, not money it
    // spends: the bill it builds toward lands once, and by then the cost has
    // already been planned for month by month. Counting it as planned spending
    // would compare a monthly set-aside against a one-off payment.
    if (isPlannedSetAside(item)) {
      plannedSetAside += amt
      continue
    }
    recurringExpenseByCat[item.category] = (recurringExpenseByCat[item.category] ?? 0) + amt
  }

  // Planned expense per category: the precise per-line plan for this month wins;
  // a flat budget only fills in categories that have no plan lines.
  const plannedExpenseByCat: Record<string, number> = { ...recurringExpenseByCat }
  for (const [cat, budget] of Object.entries(data.categoryBudgets)) {
    if (cat in plannedExpenseByCat) continue
    if (cat === SAVINGS_CATEGORY || PROVISION_CATS.has(cat)) plannedSetAside += budget
    else plannedExpenseByCat[cat] = budget
  }

  const plannedIncome = Object.values(plannedIncomeByCat).reduce((a, b) => a + b, 0)
  const plannedExpenses = Object.values(plannedExpenseByCat).reduce((a, b) => a + b, 0)

  const categories: CategoryActual[] = []

  // Income rows.
  const incomeCats = new Set([
    ...Object.keys(plannedIncomeByCat),
    ...Object.keys(actualIncomeByCat),
  ])
  for (const cat of incomeCats) {
    const planned = plannedIncomeByCat[cat] ?? 0
    const actual = actualIncomeByCat[cat] ?? 0
    categories.push({ category: cat, flow: 'income', planned, actual, variance: actual - planned })
  }

  // Expense rows. `provisionCovered` flags the portion already set aside in
  // advance via a provision, so a pre-funded bill doesn't read as a shock.
  const expenseCats = new Set([
    ...Object.keys(plannedExpenseByCat),
    ...Object.keys(actualExpenseByCat),
  ])
  for (const cat of expenseCats) {
    const planned = plannedExpenseByCat[cat] ?? 0
    const actual = actualExpenseByCat[cat] ?? 0
    categories.push({
      category: cat,
      flow: 'expense',
      planned,
      actual,
      variance: actual - planned,
      provisionCovered: provisionCovered[cat] ?? 0,
    })
  }

  // Sort: income first, then expenses by largest actual spend.
  categories.sort((a, b) => {
    if (a.flow !== b.flow) return a.flow === 'income' ? -1 : 1
    return b.actual - a.actual
  })

  return {
    month,
    income,
    expenses,
    setAside,
    // Cash left at the end: what came in, less what was spent, less what was
    // kept. Moving savings off the expense line changes how the month reads,
    // not what it left behind — this figure is the same either way.
    net: round2(income - expenses - setAside),
    netBeforeSetAside: round2(income - expenses),
    provisionedSpend,
    plannedIncome,
    plannedExpenses,
    plannedSetAside,
    plannedNet: plannedIncome - plannedExpenses - plannedSetAside,
    categories,
    transactionCount: txs.length,
    excludedIn,
    excludedOut,
  }
}

/** A focused, model-friendly breakdown of one month's actuals vs plan. */
export function monthReviewText(data: AppData, month: string): string {
  const { currency, locale } = data.settings
  const fx = (n: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  const r = computeReview(data, month)
  if (!r.transactionCount) return `No transactions have been imported for ${month} yet.`

  const lines: string[] = []
  lines.push(
    `Money date for ${month}: money in ${fx(r.income)} (planned ${fx(r.plannedIncome)}), ` +
      `spending ${fx(r.expenses)} (planned ${fx(r.plannedExpenses)}), ` +
      `set aside into provisions and savings ${fx(r.setAside)} (planned ${fx(r.plannedSetAside)}), ` +
      `net result ${fx(r.net)} (planned ${fx(r.plannedNet)}), ` +
      `which before setting anything aside was ${fx(r.netBeforeSetAside)}. ` +
      'Money set aside is reported on its own line, not as spending — it was kept, not consumed.',
  )
  if (r.provisionedSpend > 0.5) {
    lines.push(
      `A further ${fx(r.provisionedSpend)} of bills was paid this month out of provisions. That is real ` +
        'money leaving the account, but it is deliberately not in the spending or net figures above: ' +
        'the cost was charged in the earlier months that funded the pot, so charging it again now would ' +
        'count it twice and make a well-run month look disastrous.',
    )
  }
  const expenses = r.categories.filter((c) => c.flow === 'expense')
  const over = expenses.filter((c) => c.variance > 1).sort((a, b) => b.variance - a.variance)
  const under = expenses.filter((c) => c.variance < -1).sort((a, b) => a.variance - b.variance)
  if (over.length) {
    lines.push('Over plan: ' + over.map((c) => `${c.category} ${fx(c.actual)} vs ${fx(c.planned)} planned (+${fx(c.variance)})`).join('; '))
  }
  if (under.length) {
    lines.push('Under plan: ' + under.map((c) => `${c.category} ${fx(c.actual)} vs ${fx(c.planned)} planned (${fx(c.variance)})`).join('; '))
  }
  return lines.join('\n')
}

/** Actual spend per expense category across the given months, chronological. */
export function spendSeriesByCategory(
  data: AppData,
  months: string[],
): Record<string, number[]> {
  const series: Record<string, number[]> = {}
  const perMonth = months.map((m) => actualsByCategory(data, m).expense)
  const cats = new Set<string>()
  perMonth.forEach((e) => Object.keys(e).forEach((c) => cats.add(c)))
  for (const cat of cats) {
    series[cat] = perMonth.map((e) => e[cat] ?? 0)
  }
  return series
}

/** Longest monotonic run ending at the last point: +n rising, -n falling, 0 flat. */
export function streak(values: number[]): number {
  if (values.length < 2) return 0
  let up = 0
  let down = 0
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i] > values[i - 1] + 0.5) {
      if (down) break
      up++
    } else if (values[i] < values[i - 1] - 0.5) {
      if (up) break
      down++
    } else break
  }
  return up ? up : -down
}

/** A compact, model-friendly summary of the user's finances for the chatbot. */
export function financialSummary(data: AppData): string {
  const { currency } = data.settings
  const fx = (n: number) =>
    new Intl.NumberFormat(data.settings.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)

  const lines: string[] = []
  lines.push(`Base currency: ${currency}`)
  lines.push(`Total balance across accounts: ${fx(totalBalance(data))}`)
  if (data.accounts.length) {
    lines.push(
      'Accounts: ' + data.accounts.map((a) => `${a.name} ${fx(a.balance)}`).join(', '),
    )
  }

  const income = data.recurring.filter((r) => r.flow === 'income')
  const expense = data.recurring.filter((r) => r.flow === 'expense')
  if (income.length) {
    lines.push(
      'Recurring income: ' +
        income.map((r) => `${r.label} ${fx(r.amount)}/${r.cadence}`).join(', '),
    )
  }
  if (expense.length) {
    lines.push(
      'Recurring expenses: ' +
        expense.map((r) => `${r.label} ${fx(r.amount)}/${r.cadence} [${r.category}]`).join(', '),
    )
  }

  const forecast = buildForecast(data, 6)
  lines.push(
    'Next 6 months projected end-of-month balance: ' +
      forecast.map((f) => `${f.label} ${fx(f.balance)} (net ${fx(f.net)})`).join('; '),
  )

  const months = monthsWithData(data)
  if (months.length) {
    const r = computeReview(data, months[0])
    lines.push(
      `Latest reviewed month ${months[0]}: income ${fx(r.income)}, spending ${fx(r.expenses)}, ` +
        `set aside ${fx(r.setAside)}, net result ${fx(r.net)} (planned net ${fx(r.plannedNet)}).` +
        (r.provisionedSpend > 0.5
          ? ` A further ${fx(r.provisionedSpend)} of bills was paid from provisions — excluded from spending and net, because it was charged in the months that funded the pot.`
          : ''),
    )
    const over = r.categories
      .filter((c) => c.flow === 'expense' && c.variance > 1)
      .sort((a, b) => b.variance - a.variance)
      .slice(0, 4)
    if (over.length) {
      lines.push(
        'Over plan in: ' +
          over.map((c) => `${c.category} by ${fx(c.variance)}`).join(', '),
      )
    }
  }

  if (data.goals.length) {
    lines.push(
      'Goals: ' +
        data.goals
          .map((g) => `${g.label} ${fx(g.saved)}/${fx(g.target)}`)
          .join(', '),
    )
  }

  if (data.provisions.length) {
    const statuses = allProvisionStatuses(data)
    lines.push(
      'Provisions (money set aside ahead of a known bill, e.g. quarterly taxes): ' +
        statuses
          .map(
            (p) =>
              `${p.label} [${p.category}] ${fx(p.funded)}/${fx(p.targetAmount)} funded` +
              (p.dueDate ? `, due ${p.dueDate}` : '') +
              (p.suggestedMonthly ? `, ≈${fx(p.suggestedMonthly)}/mo to stay on track` : ''),
          )
          .join('; '),
    )
  }

  const events = allEventStatuses(data, todayISO())
  if (events.length) {
    lines.push(
      'Special events (trips, parties — budgeted on their own, not just part of the month): ' +
        events.slice(0, 6).map((e) => eventSummaryLine(e, fx)).join('; '),
    )
  }

  const nextMonth = addMonths(currentMonth(), 1)
  const funding = fundingPlan(data, nextMonth, todayISO())
  if (funding.total > 0.5) {
    lines.push(
      `To keep every provision and upcoming event on schedule, ${fx(funding.total)} should be moved into savings for ${nextMonth}: ` +
        funding.lines
          .filter((l) => l.amount > 0.005)
          .map((l) => `${l.label} ${fx(l.amount)}${l.status === 'due-now' ? ' (due that month)' : ''}`)
          .join(', ') +
        '. Provisions whose date has already passed are deliberately excluded — they no longer ask to be caught up.',
    )
  }

  const emergency = emergencyFundStatus(data)
  if (emergency.balance > 0.5 || emergency.targetAmount > 0) {
    lines.push(
      `Emergency fund (catch-all pot for money not earmarked for a named bill): ${fx(emergency.balance)}` +
        (emergency.targetAmount > 0 ? ` of ${fx(emergency.targetAmount)} target` : ' saved, no target set'),
    )
  }

  const scen = activeScenario(data)
  if (scen) {
    const s = scenarioSummary(data, scen)
    lines.push(
      `Active what-if scenario "${scen.name}": end-of-plan balance ${fx(s.scenarioEnd)} vs baseline ${fx(s.baseEnd)} (${fx(s.endDiff)}), ` +
        `projected low ${fx(s.scenarioLow)} vs ${fx(s.baseLow)}. ` +
        'This is a hypothetical overlay, not the committed plan.',
    )
  }
  return lines.join('\n')
}
