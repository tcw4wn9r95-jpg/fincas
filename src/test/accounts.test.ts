import { describe, expect, it } from 'vitest'
import {
  applyStatementBalance,
  buildForecast,
  currentAccount,
  hasBalanceAnchor,
  startingBalance,
  totalBalance,
} from '../lib/forecast'
import { looksLikeRevolutCSV } from '../lib/parse'
import { account, household, tx } from './fixture'
import type { Provision, RecurringItem } from '../lib/types'

const monthly = (fields: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'amount' | 'flow' | 'category'>): RecurringItem => ({
  label: fields.id,
  cadence: 'monthly',
  startDate: '2020-01-01',
  dayOfMonth: 1,
  ...fields,
})

describe('the one balance kept', () => {
  it('is the current account’s, and ignores cards and every other account', () => {
    const d = household([tx({ date: '2026-01-05', amount: -900, accountId: 'CARD', category: 'Food' })], {
      accounts: [
        account({ id: 'CARD', name: 'Diego', kind: 'card', balance: -52461 }),
        account({ id: 'FLEX', name: 'Compte flexible', balance: 25000, asOf: '2026-09-01' }),
        account({ id: 'BANK', name: 'S-Bank', tracked: true, balance: 39986.16, asOf: '2026-08-31' }),
      ],
    })
    expect(currentAccount(d)?.id).toBe('BANK')
    expect(totalBalance(d)).toBe(39986.16)
    expect(hasBalanceAnchor(d)).toBe(true)
  })

  it('is set by each current-account statement, never wound back by an older one', () => {
    const d = household([])
    expect(hasBalanceAnchor(d)).toBe(false)
    applyStatementBalance(d, { closingBalance: 1200, asOf: '2026-08-31' })
    applyStatementBalance(d, { closingBalance: 900, asOf: '2026-07-31' })
    expect([totalBalance(d), currentAccount(d)?.asOf]).toEqual([1200, '2026-08-31'])
  })

  it('drops by what moves to savings, but not again when a pot pays the bill it saved for', () => {
    const bank = account({ id: 'BANK', name: 'S-Bank', tracked: true, balance: 10000, asOf: '2000-01-31' })
    // A premium billed quarterly, saved for by a pot: the bill is paid from it.
    const tax: RecurringItem = { ...monthly({ id: 'tax', amount: 3000, flow: 'expense', category: 'Insurance' }), cadence: 'quarterly' }
    const pot: Provision = { id: 'P', label: 'Car insurance', category: 'Insurance', targetAmount: 3000, createdAt: '2026-01-01', plannedLineId: 'tax' }
    const d = household([], {
      accounts: [bank],
      recurring: [
        monthly({ id: 'pay', amount: 4000, flow: 'income', category: 'Income' }),
        monthly({ id: 'rent', amount: 1000, flow: 'expense', category: 'Housing' }),
        monthly({ id: 'save', amount: 1000, flow: 'expense', category: 'Provisions' }),
        tax,
      ],
      provisions: [pot],
    })
    const months = buildForecast(d, 3)
    // Every month: +4000 pay, −1000 rent, −1000 to savings. The quarter's
    // premium is paid from the pot, so the current account doesn't feel it.
    expect(months.map((m) => m.net)).toEqual([2000, 2000, 2000])
    expect(months[2].balance - startingBalance(d)).toBe(6000)
    // The month's own result still counts the premium as spent.
    const withTax = months.find((m) => m.expenses > 1000)
    if (withTax) expect(withTax.netResult).toBe(4000 - 4000 - 1000)
  })
})

describe('rolling the current account forward', () => {
  it('follows the plan after its last statement, not other accounts’ lines (September)', async () => {
    const { currentMonth, addMonths } = await import('../lib/format')
    const last = addMonths(currentMonth(), -2)
    const gap = addMonths(currentMonth(), -1)
    const d = household(
      // A month after the statement with Revolut spending in but no salary yet.
      [tx({ date: `${gap}-10`, amount: -9000, category: 'Food', accountId: 'REV' })],
      {
        accounts: [account({ id: 'BANK', name: 'S-Bank', tracked: true, balance: 40000, asOf: `${last}-31` })],
        recurring: [
          monthly({ id: 'pay', amount: 5000, flow: 'income', category: 'Income' }),
          monthly({ id: 'food', amount: 1000, flow: 'expense', category: 'Food' }),
        ],
      },
    )
    expect(startingBalance(d)).toBe(44000)
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
