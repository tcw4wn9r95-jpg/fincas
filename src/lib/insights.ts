import type { AppData } from './types'
import {
  monthsWithData,
  computeReview,
  spendSeriesByCategory,
  streak,
  balanceToday,
  hasBalanceAnchor,
} from './forecast'

export interface CatTrend {
  category: string
  vals: number[]
  run: number // months of consecutive rise (+) / fall (−)
  from: number
  to: number
}

export interface TopCat {
  category: string
  avg: number
  share: number
  vals: number[]
}

export interface OverPlanCat {
  category: string
  monthsOver: number
  totalMonths: number
  avgActual: number
  avgPlanned: number
}

/**
 * A standard, generic pre-investing checklist (emergency fund, savings rate,
 * high-interest debt) — informational reference points from common personal
 * finance guidance, not personalized advice. Everything here is derived
 * on-device from figures already in the app; no external data.
 */
export interface InvestmentChecklist {
  /** Total balance ÷ average monthly spend — null if spend can't be estimated yet. */
  monthsCovered: number | null
  /** The commonly cited emergency-fund range is 3–6 months of expenses. */
  emergencyFundLow: number
  emergencyFundHigh: number
  savingsRate: number
  /** ~20% is the savings slice in the widely-cited 50/30/20 budgeting guideline. */
  savingsRateBenchmark: number
  /** Count of active "Loans" plan lines — a nudge to weigh payoff against investing, not a debt payoff plan. */
  debtPlanLines: number
}

export interface Insights {
  months: string[]
  avgIncome: number
  avgSpend: number
  avgNet: number
  savingsRate: number
  savingsTrend: number // net streak over the months
  topCategories: TopCat[]
  rising: CatTrend[]
  falling: CatTrend[]
  biggestMover: { category: string; prev: number; current: number; delta: number } | null
  overPlan: OverPlanCat[]
  investment: InvestmentChecklist
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

/** Derive trends and watch-outs from the user's reconciled money-date history. */
export function deriveInsights(data: AppData): Insights | null {
  const months = monthsWithData(data).slice().sort().slice(-6)
  if (months.length === 0) return null

  const reviews = months.map((m) => computeReview(data, m))
  const avgIncome = mean(reviews.map((r) => r.income))
  const avgSpend = mean(reviews.map((r) => r.expenses))
  const avgNet = avgIncome - avgSpend
  const savingsRate = avgIncome > 0 ? avgNet / avgIncome : 0
  const savingsTrend = streak(reviews.map((r) => r.net))

  const series = spendSeriesByCategory(data, months)
  const cats = Object.entries(series).map(([category, vals]) => ({
    category,
    vals,
    avg: mean(vals),
    current: vals[vals.length - 1] ?? 0,
    prev: vals[vals.length - 2] ?? 0,
    run: streak(vals),
  }))

  const topCategories: TopCat[] = cats
    .filter((c) => c.avg > 0)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 6)
    .map((c) => ({ category: c.category, avg: c.avg, share: avgSpend > 0 ? c.avg / avgSpend : 0, vals: c.vals }))

  const rising: CatTrend[] = cats
    .filter((c) => c.run >= 2 && c.current > 5)
    .sort((a, b) => b.run - a.run)
    .map((c) => ({ category: c.category, run: c.run, from: c.vals[c.vals.length - c.run - 1] ?? c.prev, to: c.current, vals: c.vals }))

  const falling: CatTrend[] = cats
    .filter((c) => c.run <= -2 && c.avg > 5)
    .sort((a, b) => a.run - b.run)
    .map((c) => ({ category: c.category, run: -c.run, from: c.vals[c.vals.length + c.run - 1] ?? c.prev, to: c.current, vals: c.vals }))

  let biggestMover: Insights['biggestMover'] = null
  if (months.length >= 2) {
    const m = cats
      .filter((c) => c.avg > 0)
      .sort((a, b) => Math.abs(b.current - b.prev) - Math.abs(a.current - a.prev))[0]
    if (m && Math.abs(m.current - m.prev) > 5) {
      biggestMover = { category: m.category, prev: m.prev, current: m.current, delta: m.current - m.prev }
    }
  }

  // Categories that keep beating their plan.
  const agg = new Map<string, { over: number; months: number; actual: number; planned: number }>()
  for (const r of reviews) {
    for (const c of r.categories) {
      if (c.flow !== 'expense') continue
      const a = agg.get(c.category) ?? { over: 0, months: 0, actual: 0, planned: 0 }
      a.months++
      a.actual += c.actual
      a.planned += c.planned
      if (c.actual > c.planned + 1) a.over++
      agg.set(c.category, a)
    }
  }
  const overPlan: OverPlanCat[] = Array.from(agg.entries())
    .filter(([, a]) => a.planned > 0 && a.over >= 2)
    .map(([category, a]) => ({
      category,
      monthsOver: a.over,
      totalMonths: a.months,
      avgActual: a.actual / a.months,
      avgPlanned: a.planned / a.months,
    }))
    .sort((a, b) => b.avgActual - b.avgPlanned - (a.avgActual - a.avgPlanned))
    .slice(0, 4)

  // No recorded balance means no cover to measure — reporting "0 months" would
  // read as an empty account rather than a missing figure.
  const monthsCovered =
    avgSpend > 0 && hasBalanceAnchor(data)
      ? Math.round((balanceToday(data) / avgSpend) * 10) / 10
      : null
  const debtPlanLines = data.recurring.filter((r) => r.flow === 'expense' && r.category === 'Loans').length
  const investment: InvestmentChecklist = {
    monthsCovered,
    emergencyFundLow: 3,
    emergencyFundHigh: 6,
    savingsRate,
    savingsRateBenchmark: 0.2,
    debtPlanLines,
  }

  return {
    months,
    avgIncome,
    avgSpend,
    avgNet,
    savingsRate,
    savingsTrend,
    topCategories,
    rising,
    falling,
    biggestMover,
    overPlan,
    investment,
  }
}
