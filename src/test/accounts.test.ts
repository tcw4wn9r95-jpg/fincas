import { describe, expect, it } from 'vitest'
import { accountBalance } from '../lib/forecast'
import { applyRefile, lineKind, proposeRefile, REVOLUT_NAME } from '../lib/refile'
import { looksLikeRevolutCSV } from '../lib/parse'
import { account, household, tx } from './fixture'

const card = account({ id: 'CARD', name: 'Diego', kind: 'card' })
const bank = account({ id: 'BANK', name: 'S-Bank', tracked: true, balance: 5000 })

describe('which account a line belongs to', () => {
  it('reads a current-account line by its banking keyword and a card line by its merchant', () => {
    expect(lineKind(tx({ date: '2026-07-01', amount: -1, source: 'pdf', description: 'DEBIT TPV AUCHAN 03.07' }))).toBe('bank')
    expect(lineKind(tx({ date: '2026-07-01', amount: -1, source: 'pdf', description: 'STANDING ORDER IN FAVOUR OF X' }))).toBe('bank')
    expect(lineKind(tx({ date: '2026-07-01', amount: -1, source: 'pdf', description: 'AMAZON* H58WD0OO5 LUXEMBOURG' }))).toBe('card')
    expect(lineKind(tx({ date: '2026-07-01', amount: -1, source: 'csv', description: 'Wolt' }))).toBe('revolut')
    expect(lineKind(tx({ date: '2026-07-01', amount: -1, source: 'manual', description: 'lunch' }))).toBeUndefined()
  })

  // The real shape: Revolut and current-account lines filed on a card, which
  // then read thousands in credit and was quietly counted as owing nothing.
  const misfiled = () =>
    household(
      [
        tx({ date: '2026-07-02', amount: -40, source: 'csv', description: 'Wolt', accountId: 'CARD' }),
        tx({ date: '2026-07-07', amount: 2779.1, source: 'pdf', description: 'CREDIT TRANSFER FROM TRESORERIE', accountId: 'CARD' }),
        tx({ date: '2026-07-08', amount: -60, source: 'pdf', description: 'AMAZON* 6X19 LUXEMBOURG', accountId: 'BANK' }),
        tx({ date: '2026-07-09', amount: -25, source: 'pdf', description: 'SPOTIFY STOCKHOLM', accountId: 'CARD' }),
        // A duplicate waiting for the counted-twice question: left alone.
        tx({ date: '2026-07-02', amount: -40, source: 'csv', description: 'Wolt' }),
      ],
      { accounts: [card, bank] },
    )

  it('proposes each line to the account its shape says, and creates Revolut if needed', () => {
    const d = misfiled()
    const p = proposeRefile(d)
    expect(p.createsRevolut).toBe(true)
    expect(p.moves.map((m) => [m.from, m.to])).toEqual([
      ['CARD', REVOLUT_NAME],
      ['CARD', 'BANK'],
      ['BANK', 'CARD'],
    ])
  })

  it('leaves the card owing what was charged on it once applied, and has nothing left to move', () => {
    const d = misfiled()
    expect(accountBalance(d, card)).toBeGreaterThan(0)
    applyRefile(d, proposeRefile(d), () => 'REV')
    expect(d.accounts.find((a) => a.id === 'REV')?.name).toBe(REVOLUT_NAME)
    expect(accountBalance(d, card)).toBe(-85)
    expect(proposeRefile(d).moves).toEqual([])
  })

  it('skips a line the user moved after the question was asked', () => {
    const d = misfiled()
    const p = proposeRefile(d)
    d.transactions[1].accountId = 'ELSEWHERE'
    applyRefile(d, p, () => 'REV')
    expect(d.transactions[1].accountId).toBe('ELSEWHERE')
  })
})

describe('a Revolut export', () => {
  it('is recognised by its columns, since it never names Revolut', () => {
    const header = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n'
    expect(looksLikeRevolutCSV(header)).toBe(true)
    expect(looksLikeRevolutCSV('﻿' + header)).toBe(true)
    expect(looksLikeRevolutCSV('Date,Description,Amount\n')).toBe(false)
  })
})
