// Shapes netted income/expense-by-category figures (from `actualsByCategoryRange`)
// into a small three-column flow graph: income sources → a single "Income" hub
// → expense categories (+ net savings, or a "Shortfall" source when spending
// outran income). Kept independent of rendering so both the Money date and
// Dashboard views can build the same shape from different month ranges.

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
    nodes.push({ id: 'shortfall', label: 'Shortfall', value: -net, color: SHORTFALL_COLOR, column: 0 })
    links.push({ source: 'shortfall', target: 'hub', value: -net, color: 'rgba(162,74,52,0.5)' })
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
  if (net > 0.5) {
    nodes.push({ id: 'savings', label: 'Net savings', value: net, color: SAVINGS_COLOR, column: 2 })
    links.push({ source: 'hub', target: 'savings', value: net, color: 'rgba(201,161,74,0.55)' })
  }

  return { nodes, links }
}
