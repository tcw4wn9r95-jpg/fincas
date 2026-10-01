import { describe, expect, it } from 'vitest'
import { monthCoverage, settledMonths } from '../lib/coverage'
import { assumptionKey, computeMonthPulse, settleAssumptions } from '../lib/month'
import { computeReview } from '../lib/forecast'
import { account, household, tx } from './fixture'
import type { RecurringItem } from '../lib/types'

const bank = account({ id: 'BANK', name: 'S-Bank', tracked: true, asOf: '2026-08-31' })
const rev = account({ id: 'REV', name: 'Revolut' })
const line = (date: string, accountId: string, amount = -10) => tx({ date, amount, accountId, category: 'Food' })

describe('whether a month is final', () => {
  // The real September: Revolut imported to the 30th, the S-Bank statement
  // carrying the salary not yet in.
  const d = household(
    [line('2026-08-30', 'BANK'), line('2026-08-31', 'REV'), line('2026-09-29', 'REV'), line('2026-10-01', 'REV')],
    { accounts: [bank, rev] },
  )

  it('is provisional while an account in use hasn’t reached its end', () => {
    expect(monthCoverage(d, '2026-08', '2026-10-01').state).toBe('complete')
    const sep = monthCoverage(d, '2026-09', '2026-10-01')
    expect(sep.state).toBe('provisional')
    expect(sep.missing).toEqual([{ accountId: 'BANK', name: 'S-Bank', through: '2026-08-31' }])
    expect(monthCoverage(d, '2026-10', '2026-10-01').state).toBe('in-progress')
    expect(monthCoverage(d, '2026-05', '2026-10-01').state).toBe('empty')
  })

  it('keeps provisional and running months out of averages', () => {
    expect(settledMonths(d, '2026-10-01')).toEqual(['2026-08'])
  })

  it('lets an import’s statement period close a quiet account', () => {
    const withImport = { ...d, imports: [{ id: 'I', at: '', files: [], accountId: 'BANK', periodStart: '2026-09-01', periodEnd: '2026-09-30', rows: 0, total: 0 }] }
    expect(monthCoverage(withImport, '2026-09', '2026-10-01').state).toBe('complete')
  })
})

describe('bills taken on trust, once the month closes', () => {
  const insurance: RecurringItem = {
    id: 'seguro', label: 'Seguro Carro', amount: 145, flow: 'expense', cadence: 'monthly',
    category: 'Insurance', startDate: '2026-01-01', dayOfMonth: 1,
  }
  const phone: RecurringItem = { ...insurance, id: 'cel', label: 'Celulares', amount: 40, category: 'Utilities', dayOfMonth: 27 }
  const make = () =>
    household([line('2026-08-30', 'BANK'), line('2026-08-31', 'REV'), line('2026-09-02', 'REV')], {
      accounts: [bank, rev],
      recurring: [insurance, phone],
      // The user vouched for the insurance; the phone was only assumed.
      assumedPaid: { [assumptionKey('2026-08', 'seguro')]: 145 },
    })

  it('drop an automatic assumption that never charged, and list it instead', () => {
    const p = computeMonthPulse(make(), '2026-08', '2026-10-01')
    expect(p.assumed.map((a) => a.id)).toEqual(['seguro'])
    expect(p.neverCharged.map((b) => b.id)).toEqual(['cel'])
  })

  it('keep a vouched-for bill until it is recorded, after which both screens agree', () => {
    const d = make()
    expect(computeMonthPulse(d, '2026-08', '2026-10-01').spent).toBe(165)
    expect(computeReview(d, '2026-08').expenses).toBe(20)
    settleAssumptions(d, '2026-08', 'record', () => 'M1')
    expect(computeMonthPulse(d, '2026-08', '2026-10-01').spent).toBe(165)
    expect(computeReview(d, '2026-08').expenses).toBe(165)
    expect(d.assumedPaid).toEqual({})
  })

  it('or drop it, and then it counts nowhere', () => {
    const d = make()
    settleAssumptions(d, '2026-08', 'drop', () => 'M1')
    expect(computeMonthPulse(d, '2026-08', '2026-10-01').spent).toBe(20)
    expect(d.transactions).toHaveLength(3)
  })
})

describe('the health panel at month end', () => {
  it('names the provisional month and the vouched-for bills still to settle', async () => {
    const { runHealthChecks } = await import('../lib/health')
    const d = household(
      [line('2026-08-30', 'BANK'), line('2026-08-31', 'REV'), line('2026-09-29', 'REV')],
      {
        accounts: [bank, rev],
        recurring: [{ id: 'seguro', label: 'Seguro Carro', amount: 145, flow: 'expense', cadence: 'monthly', category: 'Insurance', startDate: '2026-01-01', dayOfMonth: 1 }],
        assumedPaid: { [assumptionKey('2026-08', 'seguro')]: 145 },
      },
    )
    const issues = runHealthChecks(d, '2026-10-01')
    expect(issues.map((i) => i.id)).toEqual(['provisional', 'assumed:2026-08'])
    expect(issues[0].detail).toContain('waiting for S-Bank')
    expect(issues[1].amount).toBe(145)
  })
})
