import { describe, expect, it } from 'vitest'
import { actualsByCategory, computeHistory, computeReview } from '../lib/forecast'
import { oneOffSpotter, typicalMonthlyIncome } from '../lib/health'
import { buildSankey } from '../lib/sankey'
import { household, tx } from './fixture'

describe('refunds', () => {
  // July in the real data: a €7,335 tax refund and health reimbursements
  // outrunning that month's doctors were both reported as income.
  const july = household([
    tx({ date: '2026-07-01', amount: 3000, category: 'Income' }),
    tx({ date: '2026-07-03', amount: -200, category: 'Health' }),
    tx({ date: '2026-07-17', amount: 500, category: 'Health' }),
    tx({ date: '2026-07-10', amount: -400, category: 'Food' }),
  ])

  it('never become income, whatever their sign', () => {
    const r = computeReview(july, '2026-07')
    expect(r.income).toBe(3000)
    expect(r.expenses).toBe(100) // 400 food less a net 300 refunded
    expect(r.net).toBe(2900)
    const health = r.categories.find((c) => c.category === 'Health')!
    expect(health.flow).toBe('expense')
    expect(health.actual).toBe(-300)
  })

  it('land on the cost side of the per-category actuals too', () => {
    const a = actualsByCategory(july, '2026-07')
    expect(a.income).toEqual({ Income: 3000 })
    expect(a.expense.Health).toBe(-300)
  })

  it('are drawn as a source of money in the flow diagram, not dropped', () => {
    const a = actualsByCategory(july, '2026-07')
    const g = buildSankey(a.income, a.expense)
    expect(g.nodes.some((n) => n.label === 'Refunds' && n.value === 300)).toBe(true)
  })
})

describe('one-offs', () => {
  const months = ['2026-03', '2026-04', '2026-05', '2026-06']
  const salaries = months.map((m) => tx({ date: `${m}-25`, amount: 10000, category: 'Income' }))
  const bonus = tx({ date: '2026-06-25', amount: 57403.11, category: 'Income', description: 'AMAZON EU' })
  const taxBack = tx({ date: '2026-06-24', amount: 7335, category: 'Taxes' })
  const pharmacy = tx({ date: '2026-06-20', amount: 548.14, category: 'Health' })
  const d = household([...salaries, bonus, taxBack, pharmacy])

  it('are spotted against usual income, not a fixed threshold', () => {
    expect(typicalMonthlyIncome(d)).toBe(10000)
    const spot = oneOffSpotter(d)
    expect(spot(bonus)).toBe(true)
    expect(spot(taxBack)).toBe(true)
    expect(spot(pharmacy)).toBe(false)
    expect(spot(salaries[0])).toBe(false)
  })

  it('are left out of the month but kept in the cash track', () => {
    bonus.oneOff = true
    const r = computeReview(d, '2026-06')
    expect(r.income).toBe(10000)
    expect(r.exceptional).toBe(57403.11)
    expect(r.netWithExceptional).toBe(round2(r.net + 57403.11))
    const last = computeHistory(d).at(-1)!
    expect(last.actualNet).toBe(r.net)
    expect(last.cumulativeActual).toBeCloseTo(30000 + r.netWithExceptional, 2)
    bonus.oneOff = undefined
  })
})

function round2(n: number) {
  return Math.round(n * 100) / 100
}
