import { describe, expect, it } from 'vitest'
import { foldSaved, saveImport, undoImport } from '../lib/importer'
import { parseCSV } from '../lib/parse'
import { runHealthChecks } from '../lib/health'
import { household, tx } from './fixture'
import type { Transaction } from '../lib/types'

const saved = (fields: Partial<Transaction> & { date: string; amount: number }) =>
  tx({ source: 'csv', description: 'Auchan', ...fields })
const base = { replaceMonths: true, supersededIds: [], files: ['july.csv'], at: '2026-10-01T10:00:00Z' }

describe('saving an import', () => {
  it('can no longer double a month when the account is changed after the review loaded (July)', () => {
    const july = [saved({ date: '2026-07-04', amount: -84.92, accountId: 'CARD' }), saved({ date: '2026-07-07', amount: 2779.1, description: 'Salary', accountId: 'CARD' })]
    const d = household([...july])
    const parsed = [saved({ date: '2026-07-04', amount: -84.92 }), saved({ date: '2026-07-08', amount: -12, description: 'New line' })]
    // Picked with CARD preselected: the saved card lines fold in.
    let rows = foldSaved(parsed, d.transactions, 'CARD')
    expect(rows).toHaveLength(3)
    // Then the picker is changed to the bank — the fold-in follows it.
    rows = foldSaved(rows, d.transactions, 'BANK')
    saveImport(d, { ...base, rows, accountId: 'BANK', batchId: 'B1' })
    const ids = d.transactions.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(d.transactions.filter((t) => t.accountId === 'CARD')).toHaveLength(2)
    expect(d.transactions.filter((t) => t.accountId === 'BANK')).toHaveLength(2)
  })

  it('even if a stale review is saved, a folded row replaces itself by id', () => {
    const card = saved({ date: '2026-07-04', amount: -84.92, accountId: 'CARD' })
    const d = household([card])
    saveImport(d, { ...base, rows: [card], accountId: 'BANK', batchId: 'B1' })
    expect(d.transactions.filter((t) => t.id === card.id)).toHaveLength(1)
  })

  it('replaces a copy of the same line saved before an account was picked', () => {
    const untagged = saved({ date: '2026-07-31', amount: -36.5, description: 'Bao8' })
    const d = household([untagged])
    saveImport(d, { ...base, rows: [saved({ date: '2026-07-31', amount: -36.5, description: 'Bao8' })], accountId: 'BANK', batchId: 'B1' })
    expect(d.transactions).toHaveLength(1)
    expect(d.transactions[0].accountId).toBe('BANK')
  })

  it('with no account picked, leaves every other account’s lines alone', () => {
    const card = saved({ date: '2026-07-04', amount: -5, accountId: 'CARD' })
    const d = household([card])
    saveImport(d, { ...base, rows: [saved({ date: '2026-07-05', amount: -7 })], accountId: '', batchId: 'B1' })
    expect(d.transactions.map((t) => t.id)).toContain(card.id)
  })

  it('records the import, stamps its lines, and can undo it', () => {
    const d = household([])
    saveImport(d, {
      ...base,
      rows: [saved({ date: '2026-09-02', amount: -10 }), saved({ date: '2026-09-28', amount: 2000, description: 'Salary' })],
      accountId: 'BANK',
      periodEnd: '2026-09-30',
      tieOut: { opening: 100, closing: 2090, agrees: true, difference: 0 },
      batchId: 'B1',
    })
    expect(d.imports).toEqual([
      { id: 'B1', at: base.at, files: ['july.csv'], accountId: 'BANK', source: undefined, periodStart: '2026-09-02', periodEnd: '2026-09-30', rows: 2, total: 1990, tieOut: { opening: 100, closing: 2090, agrees: true, difference: 0 } },
    ])
    expect(d.transactions.every((t) => t.importId === 'B1' && t.accountId === 'BANK')).toBe(true)
    undoImport(d, 'B1')
    expect(d.transactions).toEqual([])
    expect(d.imports).toEqual([])
  })

  it('reports an import its statement disagrees with', () => {
    const d = household([])
    saveImport(d, { ...base, rows: [saved({ date: '2026-09-02', amount: -10 })], accountId: 'BANK', tieOut: { closing: 5, agrees: false, difference: 12.5 }, batchId: 'B1' })
    expect(runHealthChecks(d, '2026-09-15').map((i) => i.id)).toContain('tie-out:B1')
  })
})

describe('a Revolut export', () => {
  const header = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'
  const csv = (...lines: string[]) => [header, ...lines].join('\n')

  it('leaves out payments that never happened, and keeps fees as their own line', () => {
    const r = parseCSV(
      csv(
        'CARD_PAYMENT,Current,2026-07-02 10:00:00,2026-07-03 09:00:00,Wolt,-38.00,0.00,EUR,COMPLETED,962.00',
        'CARD_PAYMENT,Current,2026-07-03 11:00:00,2026-07-04 09:00:00,Amazon,-20.00,0.00,EUR,REVERTED,',
        'TRANSFER,Current,2026-07-05 12:00:00,2026-07-05 12:00:00,To Pablo,-100.00,1.50,EUR,COMPLETED,860.50',
      ),
    )
    expect(r.transactions.map((t) => [t.description, t.amount])).toEqual([
      ['Wolt', -38],
      ['To Pablo', -100],
      ['Fee: To Pablo', -1.5],
    ])
    expect(r.warnings.join(' ')).toMatch(/1 payment marked reverted/)
    expect(r.tieOut).toEqual({ opening: 1000, closing: 860.5, agrees: true, difference: 0 })
  })

  it('says when the running balance doesn’t follow from the lines', () => {
    const r = parseCSV(
      csv(
        'CARD_PAYMENT,Current,2026-07-02 10:00:00,2026-07-02 10:00:00,Wolt,-38.00,0.00,EUR,COMPLETED,962.00',
        'CARD_PAYMENT,Current,2026-07-04 10:00:00,2026-07-04 10:00:00,Auchan,-10.00,0.00,EUR,COMPLETED,940.00',
      ),
    )
    expect(r.tieOut?.agrees).toBe(false)
    expect(r.tieOut?.difference).toBe(12)
  })

  it('checks each pocket against its own balance', () => {
    const r = parseCSV(
      csv(
        'CARD_PAYMENT,Current,2026-07-02 10:00:00,2026-07-02 10:00:00,Wolt,-38.00,0.00,EUR,COMPLETED,962.00',
        'TRANSFER,Savings,2026-07-02 11:00:00,2026-07-02 11:00:00,Spare change,0.50,0.00,EUR,COMPLETED,10.50',
        'CARD_PAYMENT,Current,2026-07-03 10:00:00,2026-07-03 10:00:00,Auchan,-2.00,0.00,EUR,COMPLETED,960.00',
      ),
    )
    expect(r.tieOut?.agrees).toBe(true)
  })
})
