import { describe, expect, it } from 'vitest'
import { counterpartyOf, decideCounterparty, pairTransfers, transferCounterparties } from '../lib/transfers'
import { runHealthChecks } from '../lib/health'
import { computeReview } from '../lib/forecast'
import { EMERGENCY_FUND_ID } from '../lib/provisions'
import { account, household, tx } from './fixture'

describe('who a transfer went to', () => {
  it.each([
    ['To EUR Compte flexible', 'Compte flexible'],
    ['From EUR Compte flexible', 'Compte flexible'],
    ['Payment from CASARES SILVA-SANTOS RODRIGUEZ', 'CASARES SILVA-SANTOS RODRIGUEZ'],
    ['STANDING ORDER IN FAVOUR OF Diego Casares Silva', 'Diego Casares Silva'],
    ['INSTANT CREDIT TRANSFER S-NET : 100-012233 IN FAVOUR OF Diego Casares', 'Diego Casares'],
    ['DEBIT REVOLUT**7899* 04.01', 'Revolut'],
    ['Apple Pay deposit by *7418', 'Card top-up'],
    ['Revpoints Spare change', 'Revpoints'],
  ])('%s → %s', (description, name) => {
    expect(counterpartyOf(description)).toBe(name)
  })
})

describe('transfers between your own accounts', () => {
  const accounts = [account({ id: 'BANK', name: 'S-Bank', tracked: true }), account({ id: 'REV', name: 'Revolut' })]
  const topUpOut = tx({ date: '2026-01-27', amount: -500, category: 'Internal', description: 'DEBIT REVOLUT**7899* 27.01', accountId: 'BANK' })
  const topUpIn = tx({ date: '2026-01-29', amount: 500, category: 'Internal', description: 'Apple Pay deposit by *7418', accountId: 'REV' })
  const fromJoint = tx({ date: '2026-08-14', amount: 4000, category: 'Internal', description: 'Payment from CASARES SILVA-SANTOS RODRIGUEZ', accountId: 'REV' })

  it('pair across accounts within a few days, leaving the rest unexplained', () => {
    const d = household([topUpOut, topUpIn, fromJoint], { accounts })
    const { pairs, orphans } = pairTransfers(d)
    expect(pairs.map(([o, i]) => [o.id, i.id])).toEqual([[topUpOut.id, topUpIn.id]])
    expect(orphans.map((t) => t.id)).toEqual([fromJoint.id])
  })

  it('ask once per counterparty, and a "mine" gives it an account', () => {
    const d = household([topUpOut, topUpIn, fromJoint, { ...fromJoint, id: 'J2', date: '2026-08-15', amount: 3000 }], { accounts })
    const [cp] = transferCounterparties(d)
    expect(cp.name).toBe('CASARES SILVA-SANTOS RODRIGUEZ')
    expect(cp.moneyIn).toBe(7000)
    expect(runHealthChecks(d).map((i) => i.id)).toEqual(['transfers'])
    decideCounterparty(d, cp, 'mine', () => 'JOINT')
    expect(d.accounts.at(-1)).toMatchObject({ id: 'JOINT', name: 'CASARES SILVA-SANTOS RODRIGUEZ' })
    expect(runHealthChecks(d)).toEqual([])
  })

  it('file someone else’s money as received or spent', () => {
    const gift = tx({ date: '2026-04-19', amount: -350, category: 'Internal', description: 'Transfer to Pablo Burneo', accountId: 'REV' })
    const d = household([fromJoint, gift], { accounts })
    for (const cp of transferCounterparties(d)) decideCounterparty(d, cp, 'external', () => 'X')
    expect(d.transactions.map((t) => t.category)).toEqual(['Income', 'Transfer'])
    expect(computeReview(d, '2026-08').income).toBe(4000)
  })
})

describe('pots against the account holding them', () => {
  const flexible = account({ id: 'FLEX', name: 'Compte flexible', asOf: '' })
  const saved = tx({
    date: '2026-08-14',
    amount: -4000,
    category: 'Savings',
    description: 'To EUR Compte flexible',
    provisionAllocations: [{ provisionId: EMERGENCY_FUND_ID, amount: 4000, role: 'contribution' }],
  })
  const ids = (d: ReturnType<typeof household>) => runHealthChecks(d).map((i) => i.id)

  it('names the account the set-aside went to, then asks for its balance, then compares', () => {
    const d = household([saved], { accounts: [flexible] })
    const unbacked = runHealthChecks(d).find((i) => i.id === 'pots-unbacked')!
    expect(unbacked.actions?.[0]).toMatchObject({ kind: 'set-pots-account', accountId: 'FLEX' })
    d.provisionAccountId = 'FLEX'
    expect(ids(d)).toEqual(['pots-no-balance'])
    d.accounts[0] = { ...flexible, balance: 3000, asOf: '2026-09-30' }
    const gap = runHealthChecks(d).find((i) => i.id === 'pots-gap')!
    expect(gap.severity).toBe('error')
    expect(gap.amount).toBe(1000)
    d.accounts[0].balance = 4000
    expect(ids(d)).toEqual([])
  })
})
