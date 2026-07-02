import type {
  AppData,
  RecurringItem,
  ForecastPoint,
  MonthReview,
  CategoryActual,
} from './types'
import { currentMonth, monthRange, shortMonth } from './format'

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

// Which planner section a line belongs to. An explicit `group` wins; otherwise
// we infer it from the category. Used for subtotals and the fixed/variable split.
const FIXED_CATS = new Set(['Loans', 'Utilities', 'Insurance', 'Subscriptions', 'Entertainment'])
const PROVISION_CATS = new Set(['Taxes', 'Provisions', 'Travel'])

export function planSection(item: RecurringItem): string {
  if (item.group) return item.group
  if (item.flow === 'income') return 'Income'
  if (FIXED_CATS.has(item.category)) return 'Fixed monthly'
  if (PROVISION_CATS.has(item.category)) return 'Provisions'
  return 'Variable'
}

/** Variable = the "Variable" section (everything after Imprevistos); else fixed. */
export function isVariableExpense(item: RecurringItem): boolean {
  return item.flow === 'expense' && planSection(item) === 'Variable'
}

/** How much a recurring item contributes during a given YYYY-MM. */
export function itemAmountForMonth(item: RecurringItem, month: string): number {
  // An explicit per-month value always wins — this is what makes the plan precise.
  if (item.monthly && Object.prototype.hasOwnProperty.call(item.monthly, month)) {
    const v = item.monthly[month]
    if (typeof v === 'number' && !Number.isNaN(v)) return v
  }
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

export function totalBalance(data: AppData): number {
  return data.accounts.reduce((sum, a) => sum + a.balance, 0)
}

/** The latest month any plan line has an explicit value for (or '' if none). */
export function lastPlanMonth(data: AppData): string {
  let last = ''
  for (const item of data.recurring) {
    if (!item.monthly) continue
    for (const m of Object.keys(item.monthly)) {
      if (m > last) last = m
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
  let running = totalBalance(data)
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

/** Months that actually have imported/added transactions, newest first. */
export function monthsWithData(data: AppData): string[] {
  const set = new Set(data.transactions.map((t) => t.month))
  return Array.from(set).sort().reverse()
}

/**
 * The "money date" review: actuals vs. plan for a single month, broken
 * down by category, so the user can see where they stand.
 */
export function computeReview(data: AppData, month: string): MonthReview {
  const txs = data.transactions.filter((t) => t.month === month)

  let income = 0
  let expenses = 0
  const actualIncomeByCat: Record<string, number> = {}
  const actualExpenseByCat: Record<string, number> = {}

  for (const t of txs) {
    if (t.amount >= 0) {
      income += t.amount
      actualIncomeByCat[t.category] = (actualIncomeByCat[t.category] ?? 0) + t.amount
    } else {
      const abs = Math.abs(t.amount)
      expenses += abs
      actualExpenseByCat[t.category] = (actualExpenseByCat[t.category] ?? 0) + abs
    }
  }

  // Planned figures from recurring items for this month.
  const plannedIncomeByCat: Record<string, number> = {}
  const recurringExpenseByCat: Record<string, number> = {}
  for (const item of data.recurring) {
    const amt = itemAmountForMonth(item, month)
    if (amt === 0) continue
    if (item.flow === 'income') {
      plannedIncomeByCat[item.category] = (plannedIncomeByCat[item.category] ?? 0) + amt
    } else {
      recurringExpenseByCat[item.category] = (recurringExpenseByCat[item.category] ?? 0) + amt
    }
  }

  // Planned expense per category: the precise per-line plan for this month wins;
  // a flat budget only fills in categories that have no plan lines.
  const plannedExpenseByCat: Record<string, number> = { ...recurringExpenseByCat }
  for (const [cat, budget] of Object.entries(data.categoryBudgets)) {
    if (!(cat in plannedExpenseByCat)) plannedExpenseByCat[cat] = budget
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

  // Expense rows.
  const expenseCats = new Set([
    ...Object.keys(plannedExpenseByCat),
    ...Object.keys(actualExpenseByCat),
  ])
  for (const cat of expenseCats) {
    const planned = plannedExpenseByCat[cat] ?? 0
    const actual = actualExpenseByCat[cat] ?? 0
    categories.push({ category: cat, flow: 'expense', planned, actual, variance: actual - planned })
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
    net: income - expenses,
    plannedIncome,
    plannedExpenses,
    plannedNet: plannedIncome - plannedExpenses,
    categories,
    transactionCount: txs.length,
  }
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
      `Latest reviewed month ${months[0]}: income ${fx(r.income)}, expenses ${fx(r.expenses)}, net ${fx(r.net)} (planned net ${fx(r.plannedNet)}).`,
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
  return lines.join('\n')
}
