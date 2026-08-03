import type { AppData, Transaction } from './types'
import { variablePlanForMonth } from './forecast'

// The weekly check-in works off a *sample* of variable spending (a Revolut
// export), kept in data.sampleTransactions. It's a fast pulse — "am I on track
// this week?" — as opposed to the monthly money date's full reconciliation.

const DAY = 86400000
const AVG_MONTH_DAYS = 30.44

function parseISO(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday (ISO) of the week containing the given date. */
export function weekStartOf(dateISO: string): string {
  const d = parseISO(dateISO)
  const dow = (d.getDay() + 6) % 7 // 0 = Monday
  return toISO(new Date(d.getTime() - dow * DAY))
}

export function addDaysISO(dateISO: string, n: number): string {
  return toISO(new Date(parseISO(dateISO).getTime() + n * DAY))
}

/** e.g. "Jul 7 – 13" for the week starting on the given Monday. */
export function weekLabel(weekStart: string, locale = 'en-US'): string {
  const start = parseISO(weekStart)
  const end = new Date(start.getTime() + 6 * DAY)
  const sameMonth = start.getMonth() === end.getMonth()
  const startStr = start.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString(locale, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })
  return `${startStr} – ${endStr}`
}

/** Unique week-start keys present in the sample data, newest first. */
export function weeksWithSample(data: AppData): string[] {
  const set = new Set<string>()
  for (const t of data.sampleTransactions ?? []) set.add(weekStartOf(t.date))
  return Array.from(set).sort().reverse()
}

export interface WeekCategory {
  category: string
  amount: number
}

export interface WeekReview {
  weekStart: string
  weekEnd: string
  /** Total variable spend in the week (positive number). */
  spend: number
  moneyIn: number
  count: number
  daysElapsed: number
  byCategory: WeekCategory[]
  /** Planned variable budget for the month this week falls in. */
  monthlyVariablePlan: number
  weeklyBudget: number
  /** spend − weeklyBudget (positive = over). */
  vsBudget: number
  /** Projected month-end variable spend at this week's daily pace. */
  paceMonthly: number
  /** paceMonthly − monthlyVariablePlan. */
  vsPlanMonthly: number
  prevSpend: number
  delta: number
  /** Weekly spend totals across recent weeks, chronological (for a sparkline). */
  series: number[]
}

function weekSpend(txs: Transaction[], weekStart: string): { spend: number; moneyIn: number; count: number; byCat: Map<string, number> } {
  const end = addDaysISO(weekStart, 7)
  let spend = 0
  let moneyIn = 0
  let count = 0
  const byCat = new Map<string, number>()
  for (const t of txs) {
    if (t.date < weekStart || t.date >= end) continue
    if (t.amount < 0) {
      const abs = Math.abs(t.amount)
      spend += abs
      count++
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + abs)
    } else {
      moneyIn += t.amount
    }
  }
  return { spend, moneyIn, count, byCat }
}

export function computeWeek(data: AppData, weekStart: string): WeekReview {
  const txs = data.sampleTransactions ?? []
  const { spend, moneyIn, count, byCat } = weekSpend(txs, weekStart)
  const weekEnd = addDaysISO(weekStart, 6)

  // How much of the week has actually happened — so a mid-week check-in paces
  // off elapsed days, not a full 7.
  const todayISO = toISO(new Date())
  let daysElapsed = 7
  if (todayISO < weekStart) daysElapsed = 0
  else if (todayISO <= weekEnd) {
    daysElapsed = Math.round((parseISO(todayISO).getTime() - parseISO(weekStart).getTime()) / DAY) + 1
  }
  const dailyRate = daysElapsed > 0 ? spend / daysElapsed : 0

  const month = weekStart.slice(0, 7)
  const monthlyVariablePlan = variablePlanForMonth(data, month)
  const weeklyBudget = (monthlyVariablePlan * 7) / AVG_MONTH_DAYS
  const paceMonthly = dailyRate * AVG_MONTH_DAYS

  const prev = weekSpend(txs, addDaysISO(weekStart, -7))

  const allWeeks = weeksWithSample(data).filter((w) => w <= weekStart).slice(0, 8).reverse()
  const series = allWeeks.map((w) => weekSpend(txs, w).spend)

  const byCategory = Array.from(byCat.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)

  return {
    weekStart,
    weekEnd,
    spend,
    moneyIn,
    count,
    daysElapsed,
    byCategory,
    monthlyVariablePlan,
    weeklyBudget,
    vsBudget: spend - weeklyBudget,
    paceMonthly,
    vsPlanMonthly: paceMonthly - monthlyVariablePlan,
    prevSpend: prev.spend,
    delta: spend - prev.spend,
    series,
  }
}

/** Model-friendly recap of a week, for handing off to the assistant. */
export function weeklyReviewText(data: AppData, weekStart: string, locale = 'en-US'): string {
  const { currency } = data.settings
  const fx = (n: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  const r = computeWeek(data, weekStart)
  const lines: string[] = []
  lines.push(
    `Weekly check-in (${weekLabel(weekStart, locale)}), from a Revolut sample of variable spending: ` +
      `${fx(r.spend)} spent over ${r.count} transactions in ${r.daysElapsed} day(s).`,
  )
  if (r.monthlyVariablePlan > 0) {
    lines.push(
      `Weekly variable budget is about ${fx(r.weeklyBudget)} (from ${fx(r.monthlyVariablePlan)}/month planned). ` +
        `At this pace the month lands near ${fx(r.paceMonthly)} — ${r.vsPlanMonthly >= 0 ? 'over' : 'under'} plan by ${fx(Math.abs(r.vsPlanMonthly))}.`,
    )
  }
  if (r.prevSpend > 0) {
    lines.push(`Previous week: ${fx(r.prevSpend)} (${r.delta >= 0 ? 'up' : 'down'} ${fx(Math.abs(r.delta))}).`)
  }
  if (r.byCategory.length) {
    lines.push('Top categories: ' + r.byCategory.slice(0, 5).map((c) => `${c.category} ${fx(c.amount)}`).join(', ') + '.')
  }
  return lines.join('\n')
}
