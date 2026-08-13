// Shapes netted income/expense-by-category figures (from `actualsByCategoryRange`)
// into a small three-column flow graph: income sources → a single "Income" hub
// → expense categories (+ net savings, or a "Shortfall" source when spending
// outran income). Kept independent of rendering so both the Money date and
// Dashboard views can build the same shape from different month ranges.

import { formatMoney } from './format'

export interface SankeyNode {
  id: string
  label: string
  value: number
  color: string
  column: number
}

export interface SankeyLink {
  source: string
  target: string
  value: number
  color: string
}

export interface SankeyGraph {
  nodes: SankeyNode[]
  links: SankeyLink[]
}

const INCOME_COLOR = '#6fae93' // sage — positive / growth
const HUB_COLOR = '#1f3d34' // forest — brand
const EXPENSE_COLOR = '#c2724e' // clay — expense accent
const SAVINGS_COLOR = '#c9a14a' // gold — highlight
const SHORTFALL_COLOR = '#a24a34' // deeper clay — spending beyond income

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Build the income → hub → expenses/savings flow graph for a netted category
 * breakdown. `provisionCovered` (category → amount) splits off the portion of
 * a category's spend that was already set aside in a provision ahead of
 * time — drawn in a distinct gold, the same family as Net savings, so it
 * reads as money you'd already accounted for rather than a fresh hit.
 */
export function buildSankey(
  income: Record<string, number>,
  expense: Record<string, number>,
  provisionCovered: Record<string, number> = {},
  /** Money deliberately kept, drawn apart from what merely wasn't spent. */
  setAside = 0,
): SankeyGraph {
  const incomeCats = Object.entries(income)
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
  const expenseCats = Object.entries(expense)
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
  const totalIncome = incomeCats.reduce((s, [, v]) => s + v, 0)
  const totalExpense = expenseCats.reduce((s, [, v]) => s + v, 0)
  if (totalIncome <= 0.5 && totalExpense <= 0.5) return { nodes: [], links: [] }

  const net = totalIncome - totalExpense
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []

  // Expense links get darker/more opaque clay the bigger the category — a
  // sequential (magnitude) read layered on top of the categorical node fill,
  // since every node is already directly labeled with its name.
  const maxExpense = expenseCats[0]?.[1] ?? 0
  const expenseFill = (v: number) => {
    const t = maxExpense > 0 ? Math.sqrt(v / maxExpense) : 0
    const alpha = 0.4 + 0.5 * t
    return `rgba(194,114,78,${alpha.toFixed(2)})`
  }

  for (const [cat, v] of incomeCats) {
    nodes.push({ id: `in:${cat}`, label: cat, value: v, color: INCOME_COLOR, column: 0 })
    links.push({ source: `in:${cat}`, target: 'hub', value: v, color: 'rgba(111,174,147,0.5)' })
  }
  if (net < -0.5) {
    // A real cash gap — but if a provision was drawn down to cover part of
    // it, that portion isn't a genuine shortfall, just savings arriving from
    // an earlier month. Split it so only the unexplained remainder reads as
    // a warning; this is purely a presentation split, not new money — it
    // doesn't touch the income/expense totals the rest of the app relies on.
    const deficit = -net
    const totalProvisioned = round2(
      Object.values(provisionCovered).reduce((s, v2) => s + Math.max(0, v2), 0),
    )
    const fromProvisions = round2(Math.min(deficit, totalProvisioned))
    const shortfall = round2(deficit - fromProvisions)
    if (fromProvisions > 0.5) {
      nodes.push({ id: 'from-provisions', label: 'From provisions', value: fromProvisions, color: SAVINGS_COLOR, column: 0 })
      links.push({ source: 'from-provisions', target: 'hub', value: fromProvisions, color: 'rgba(201,161,74,0.5)' })
    }
    if (shortfall > 0.5) {
      nodes.push({ id: 'shortfall', label: 'Shortfall', value: shortfall, color: SHORTFALL_COLOR, column: 0 })
      links.push({ source: 'shortfall', target: 'hub', value: shortfall, color: 'rgba(162,74,52,0.5)' })
    }
  }

  const hubValue = Math.max(totalIncome, totalExpense)
  nodes.push({ id: 'hub', label: 'Income', value: hubValue, color: HUB_COLOR, column: 1 })

  for (const [cat, v] of expenseCats) {
    const covered = round2(Math.min(v, Math.max(0, provisionCovered[cat] ?? 0)))
    const remainder = round2(v - covered)
    if (covered > 0.5) {
      nodes.push({
        id: `out:${cat}:provisioned`,
        label: `${cat} (provisioned)`,
        value: covered,
        color: SAVINGS_COLOR,
        column: 2,
      })
      links.push({ source: 'hub', target: `out:${cat}:provisioned`, value: covered, color: 'rgba(201,161,74,0.5)' })
    }
    if (remainder > 0.5) {
      nodes.push({ id: `out:${cat}`, label: cat, value: remainder, color: EXPENSE_COLOR, column: 2 })
      links.push({ source: 'hub', target: `out:${cat}`, value: remainder, color: expenseFill(remainder) })
    }
  }
  // What was put away on purpose reads differently from what happened to be
  // left at the end, so the two leave the hub as separate flows.
  const kept = round2(Math.max(0, Math.min(setAside, Math.max(0, net))))
  const leftOver = round2(Math.max(0, net) - kept)
  if (kept > 0.5) {
    nodes.push({ id: 'set-aside', label: 'Set aside', value: kept, color: SAVINGS_COLOR, column: 2 })
    links.push({ source: 'hub', target: 'set-aside', value: kept, color: 'rgba(201,161,74,0.55)' })
  }
  if (leftOver > 0.5) {
    nodes.push({ id: 'savings', label: 'Left over', value: leftOver, color: SAVINGS_COLOR, column: 2 })
    links.push({ source: 'hub', target: 'savings', value: leftOver, color: 'rgba(201,161,74,0.4)' })
  }

  return { nodes, links }
}

/**
 * A short, deterministic (no AI call needed) written read of the same figures
 * behind the diagram — the biggest flows, the savings rate, and anything
 * already covered by a provision — for the Sankey's full-page detail view.
 */
export function describeSankeyFlow(
  income: Record<string, number>,
  expense: Record<string, number>,
  provisionCovered: Record<string, number>,
  currency: string,
  locale: string,
  setAside = 0,
): string[] {
  const fx = (n: number) => formatMoney(n, currency, locale, { round: true })
  const incomeCats = Object.entries(income).filter(([, v]) => v > 0.5)
  const expenseCats = Object.entries(expense)
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
  const totalIncome = incomeCats.reduce((s, [, v]) => s + v, 0)
  const totalExpense = expenseCats.reduce((s, [, v]) => s + v, 0)
  if (totalIncome <= 0.5 && totalExpense <= 0.5) return []

  const net = totalIncome - totalExpense
  const lines: string[] = []
  const coveredEntries = Object.entries(provisionCovered).filter(([, v]) => v > 0.5)
  const provisionedTotal = round2(coveredEntries.reduce((s, [, v]) => s + v, 0))

  if (totalIncome > 0.5 && net >= 0) {
    const rate = Math.round((net / totalIncome) * 100)
    lines.push(
      `${fx(totalIncome)} came in against ${fx(totalExpense)} spent — a ${rate}% savings rate.` +
        (setAside > 0.5
          ? ` ${fx(Math.min(setAside, net))} of that was deliberately set aside into provisions and savings, not merely unspent.`
          : ''),
    )
  } else if (net < -0.5) {
    const deficit = -net
    const fromProvisions = Math.min(deficit, provisionedTotal)
    lines.push(
      fromProvisions > 0.5
        ? `${fx(totalExpense)} went out against ${fx(totalIncome)} in. ${fx(fromProvisions)} of the ${fx(deficit)} gap came from money already set aside in a provision` +
          (fromProvisions < deficit - 0.5 ? `, leaving a real shortfall of ${fx(deficit - fromProvisions)}.` : ' — not a real shortfall.')
        : `${fx(totalExpense)} went out against ${fx(totalIncome)} in — spending outpaced income by ${fx(deficit)}.`,
    )
  } else if (totalExpense > 0.5) {
    lines.push(`${fx(totalExpense)} went out with no income recorded for this period.`)
  }

  if (expenseCats.length > 0) {
    const [topCat, topVal] = expenseCats[0]
    const share = totalExpense > 0 ? Math.round((topVal / totalExpense) * 100) : 0
    lines.push(`${topCat} was the biggest outflow at ${fx(topVal)} (${share}% of spending).`)
  }
  if (expenseCats.length > 1) {
    const [cat2, val2] = expenseCats[1]
    lines.push(`${cat2} followed at ${fx(val2)}.`)
  }

  if (provisionedTotal > 0.5) {
    const detail = coveredEntries.map(([cat, v]) => `${fx(v)} on ${cat}`).join(', ')
    lines.push(
      `${fx(provisionedTotal)} of spending (${detail}) was already provisioned for in earlier months, so it didn't land as a surprise.`,
    )
  }

  return lines
}
