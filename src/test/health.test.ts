import { describe, expect, it } from 'vitest'
import { runHealthChecks, loadRepairs } from '../lib/health'
import { duplicatePairs, resolveDuplicate } from '../lib/month'
import { applyRefile } from '../lib/refile'
import { dropRepeatedIds } from '../lib/storage'
import { emergencyFundStatus, EMERGENCY_FUND_ID } from '../lib/provisions'
import { account, household, tx } from './fixture'

const ids = (d: ReturnType<typeof household>) => runHealthChecks(d).map((i) => i.id)

describe('data health', () => {
  it('passes a clean household', () => {
    const d = household(
      [tx({ date: '2026-07-01', amount: 3000, category: 'Income', source: 'pdf', description: 'CREDIT TRANSFER FROM X', accountId: 'BANK' })],
      { accounts: [account({ id: 'BANK', name: 'S-Bank', tracked: true })] },
    )
    expect(runHealthChecks(d)).toEqual([])
  })

  it('collapses a record stored twice, keeping the copy written last', () => {
    const a = tx({ date: '2026-07-04', amount: -84.92, category: 'Food' })
    const edited = { ...a, category: 'Dining' }
    const before = loadRepairs.repeatedIds
    const d = dropRepeatedIds(household([a, tx({ date: '2026-07-05', amount: -1 }), edited]))
    expect(d.transactions).toHaveLength(2)
    expect(d.transactions.filter((t) => t.id === a.id)).toEqual([edited])
    expect(loadRepairs.repeatedIds - before).toBe(1)
    loadRepairs.repeatedIds = before
  })

  // The August shape: a transfer split across pots on the copy saved first,
  // re-imported bare under the account — and the emergency fund credited twice.
  it('fixes every re-import pair in bulk without losing the work on them', () => {
    const worked = tx({
      date: '2026-08-14',
      amount: -4000,
      source: 'csv',
      category: 'Savings',
      description: 'To EUR Compte flexible',
      reconciled: true,
      provisionAllocations: [{ provisionId: EMERGENCY_FUND_ID, amount: 4000, role: 'contribution' }],
    })
    const bare = { ...worked, id: 'BARE', accountId: 'REV', provisionAllocations: [{ provisionId: EMERGENCY_FUND_ID, amount: 4000, role: 'contribution' as const }] }
    delete (bare as { reconciled?: boolean }).reconciled
    const d = household([worked, bare], { accounts: [account({ id: 'REV', name: 'Revolut' })] })
    expect(emergencyFundStatus(d).balance).toBe(8000)
    const issue = runHealthChecks(d).find((i) => i.id === 'duplicates')!
    expect(issue.actions?.[0]).toEqual({ kind: 'resolve-duplicates', months: ['2026-08'] })
    for (const p of duplicatePairs(d, '2026-08')) resolveDuplicate(d, p, 'imported')
    expect(d.transactions).toHaveLength(1)
    expect(d.transactions[0].id).toBe(worked.id)
    expect(d.transactions[0].accountId).toBe('REV')
    expect(emergencyFundStatus(d).balance).toBe(4000)
    expect(ids(d)).not.toContain('duplicates')
  })

  it('names lines on the wrong account, and the card they leave in credit', () => {
    const card = account({ id: 'CARD', name: 'Diego', kind: 'card' })
    const d = household(
      [tx({ date: '2026-07-07', amount: 2779.1, source: 'pdf', description: 'CREDIT TRANSFER FROM TRESORERIE', accountId: 'CARD' })],
      { accounts: [card, account({ id: 'BANK', name: 'S-Bank', tracked: true })] },
    )
    expect(ids(d)).toEqual(['refile', 'card-credit:CARD'])
    const refile = runHealthChecks(d)[0].actions![0]
    if (refile.kind !== 'refile') throw new Error('expected a refile action')
    applyRefile(d, refile.proposal, () => 'X')
    expect(ids(d)).toEqual([])
  })

  it('asks about a receipt far above the usual month, and stops once it is marked', () => {
    const salaries = ['03', '04', '05'].map((m) => tx({ date: `2026-${m}-25`, amount: 10000, category: 'Income' }))
    const bonus = tx({ date: '2026-06-25', amount: 57403.11, category: 'Income' })
    const d = household([...salaries, bonus])
    expect(ids(d)).toEqual(['one-offs'])
    bonus.oneOff = true
    expect(ids(d)).toEqual([])
  })
})
