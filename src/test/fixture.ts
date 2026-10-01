// A synthetic household for the test suite, shaped on the real patterns that
// broke things — never real data, which must never be committed here (see
// .gitignore). Builders only: each test assembles exactly the rows it is about.

import { emptyData } from '../lib/storage'
import type { Account, AppData, Transaction } from '../lib/types'

let seq = 0

export function tx(fields: Partial<Transaction> & { date: string; amount: number }): Transaction {
  seq += 1
  return {
    id: `T${seq}`,
    description: `Line ${seq}`,
    category: fields.amount > 0 ? 'Income' : 'Food',
    source: 'manual',
    month: fields.date.slice(0, 7),
    ...fields,
  }
}

export function account(fields: Partial<Account> & { id: string; name: string }): Account {
  return { balance: 0, asOf: '2026-01-01', ...fields }
}

export function household(transactions: Transaction[] = [], extra: Partial<AppData> = {}): AppData {
  const d = emptyData()
  d.settings.currency = 'EUR'
  d.settings.locale = 'en-GB'
  return { ...d, transactions, ...extra }
}
