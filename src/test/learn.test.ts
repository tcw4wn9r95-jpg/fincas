import { describe, expect, it } from 'vitest'
import { habitsTable, merchantKey, recall, reconciledHistory, similarPrecedents } from '../lib/learn'
import { household, tx } from './fixture'

describe('the merchant a line is about', () => {
  it.each([
    ['DEBIT TPV AUCHAN LUXEMBOURG 03.07', 'auchan luxembourg'],
    ['DEBIT TPV AUCHAN LUXEMBOURG 21.08', 'auchan luxembourg'],
    ['AMAZON* H58WD0OO5 LUXEMBOURG', 'amazon luxembourg'],
    ['STANDING ORDER IN FAVOUR OF CASARES SILVA DIEGO FABIAN', 'casares silva diego fabian'],
    ['To EUR Compte flexible', 'compte flexible'],
    ['Wolt', 'wolt'],
  ])('%s → %s', (description, key) => {
    expect(merchantKey(description)).toBe(key)
  })
})

describe('recalling what you reconciled', () => {
  const r = (fields: Parameters<typeof tx>[0]) => tx({ reconciled: true, source: 'pdf', ...fields })
  const d = household([
    r({ date: '2026-06-03', amount: -84.92, description: 'DEBIT TPV AUCHAN LUXEMBOURG 03.06', category: 'Food' }),
    r({ date: '2026-07-03', amount: -31.1, description: 'DEBIT TPV AUCHAN LUXEMBOURG 03.07', category: 'Food' }),
    // The same standing order: the loan at one amount, savings at another.
    r({ date: '2026-07-01', amount: -3824.73, description: 'STANDING ORDER IN FAVOUR OF CASARES SILVA DIEGO', category: 'Loans' }),
    r({ date: '2026-07-01', amount: -200, description: 'STANDING ORDER IN FAVOUR OF CASARES SILVA DIEGO', category: 'Savings' }),
    r({ date: '2026-07-09', amount: -12, description: 'Kawa Deluxe', category: 'Dining' }),
    // Unconfirmed guesses teach nothing.
    tx({ date: '2026-07-10', amount: -50, description: 'Mystery Shop', category: 'Shopping', source: 'csv' }),
  ])
  const history = reconciledHistory(d)

  it('files a merchant you always file one way, whatever its date or reference', () => {
    expect(recall(history, { description: 'DEBIT TPV AUCHAN LUXEMBOURG 18.09', amount: -60 })).toEqual({ category: 'Food', confidence: 'sure', support: 2 })
  })

  it('lets the amount decide when the same wording has meant two things', () => {
    const desc = 'STANDING ORDER IN FAVOUR OF CASARES SILVA DIEGO'
    expect(recall(history, { description: desc, amount: -3824.73 })?.category).toBe('Loans')
    expect(recall(history, { description: desc, amount: -200 })).toMatchObject({ category: 'Savings', confidence: 'sure' })
    expect(recall(history, { description: desc, amount: -1000 })?.confidence).toBe('likely')
  })

  it('is only a hint after a single line at a different amount, and silent for money going the other way', () => {
    expect(recall(history, { description: 'Kawa Deluxe', amount: -20 })?.confidence).toBe('likely')
    expect(recall(history, { description: 'Kawa Deluxe', amount: 20 })).toBeNull()
    expect(recall(history, { description: 'Mystery Shop', amount: -50 })).toBeNull()
  })

  it('offers merchants sharing a name as precedents, and a habits table for the model', () => {
    expect(similarPrecedents(history, { description: 'AUCHAN KIRCHBERG' }).map((p) => p.category)).toEqual(['Food'])
    expect(habitsTable(history)[0]).toBe('auchan luxembourg → Food ×2 (≈-31.1)')
  })
})
