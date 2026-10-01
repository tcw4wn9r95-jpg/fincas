// ── Money moved between your own accounts ─────────────────────────
// A transfer filed as Internal is left out of income and spending on the
// promise that it is the same euro leaving one of your accounts and arriving
// in another. Nothing checked that promise: in the real data, August's
// Internal lines took in €13,797 more than they sent, and September's
// €13,373 — money arriving from accounts this app has never seen, counted as
// neither income nor anything else.
//
// So each transfer is paired with its other side where both accounts are
// imported, and what is left is grouped by who it went to or came from. That
// counterparty is then asked about once: is it yours (an account not imported
// yet — "Compte flexible", a joint account) or someone else's (in which case
// the lines aren't transfers at all, and are filed as money in or out)?

import type { AppData, Transaction } from './types'
import { INCOME_CATEGORY } from './categorize'

const round2 = (n: number) => Math.round(n * 100) / 100

const INTERNAL = 'Internal'
/** Days a transfer may take to land on the other side. */
const SETTLE_DAYS = 4

/**
 * Who a transfer went to or came from, read off the way each bank prints it.
 * Normalised so "To EUR Compte flexible" and "From EUR Compte flexible" are one
 * counterparty, and reference numbers don't split one payee into many.
 */
export function counterpartyOf(description: string): string {
  const d = description.trim()
  const pick = (re: RegExp) => d.match(re)?.[1]?.trim()
  const name =
    pick(/^(?:to|from) [A-Z]{3} (.+)$/i) ??
    pick(/^(?:payment|transfer) (?:from|to) (.+)$/i) ??
    pick(/(?:in favour of|from) (.+)$/i) ??
    (/^(apple pay deposit|top-up by)/i.test(d) ? 'Card top-up' : undefined) ??
    (/^debit revolut/i.test(d) ? 'Revolut' : undefined) ??
    (/^revpoints/i.test(d) ? 'Revpoints' : undefined) ??
    (/^exchanged to/i.test(d) ? 'Currency exchange' : undefined) ??
    d
  return name
    .replace(/\b(?:s-net\s*:\s*)?[\d-]{5,}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export const counterpartyKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

/**
 * Pair each Internal line leaving one account with the line arriving in
 * another: same amount, opposite sign, within a few days. Closest dates first,
 * so a weekly €500 top-up pairs with its own week rather than its neighbour's.
 */
export function pairTransfers(data: AppData): { pairs: Array<[Transaction, Transaction]>; orphans: Transaction[] } {
  const internal = data.transactions.filter((t) => t.category === INTERNAL)
  const outs = internal.filter((t) => t.amount < 0)
  const ins = internal.filter((t) => t.amount > 0)
  const candidates: Array<{ o: Transaction; i: Transaction; gap: number }> = []
  for (const o of outs) {
    for (const i of ins) {
      // Same account is allowed: Diego's and Diana's Revolut exports land in
      // one account, and a transfer between them nets out inside it.
      if (Math.abs(o.amount + i.amount) > 0.005) continue
      const gap = Math.abs(dayNumber(i.date) - dayNumber(o.date))
      if (gap <= SETTLE_DAYS) candidates.push({ o, i, gap })
    }
  }
  candidates.sort((a, b) => a.gap - b.gap)
  const used = new Set<string>()
  const pairs: Array<[Transaction, Transaction]> = []
  for (const c of candidates) {
    if (used.has(c.o.id) || used.has(c.i.id)) continue
    used.add(c.o.id)
    used.add(c.i.id)
    pairs.push([c.o, c.i])
  }
  return { pairs, orphans: internal.filter((t) => !used.has(t.id)) }
}

export interface Counterparty {
  key: string
  name: string
  decision?: 'mine' | 'external'
  /** Internal lines to or from it with no other side among your accounts. */
  orphans: Transaction[]
  moneyIn: number
  moneyOut: number
}

/** Unpaired transfers, grouped by who they went to or came from, largest first. */
export function transferCounterparties(data: AppData): Counterparty[] {
  const groups = new Map<string, Counterparty>()
  for (const t of pairTransfers(data).orphans) {
    const name = counterpartyOf(t.description)
    const key = counterpartyKey(name)
    const g =
      groups.get(key) ??
      groups
        .set(key, { key, name, decision: data.counterparties?.[key], orphans: [], moneyIn: 0, moneyOut: 0 })
        .get(key)!
    g.orphans.push(t)
    if (t.amount > 0) g.moneyIn = round2(g.moneyIn + t.amount)
    else g.moneyOut = round2(g.moneyOut - t.amount)
  }
  return [...groups.values()].sort((a, b) => b.moneyIn + b.moneyOut - (a.moneyIn + a.moneyOut))
}

/**
 * Record what a counterparty is. Yours: it gets an account (not tracked —
 * nothing is imported for it yet) so the pots can be checked against it.
 * Someone else's: its unpaired lines stop being transfers, since money that
 * left the household was spent and money that arrived was received.
 */
export function decideCounterparty(
  d: AppData,
  cp: Pick<Counterparty, 'key' | 'name' | 'orphans'>,
  decision: 'mine' | 'external',
  newId: () => string,
): AppData {
  d.counterparties = { ...(d.counterparties ?? {}), [cp.key]: decision }
  if (decision === 'mine') {
    const exists = d.accounts.some((a) => counterpartyKey(a.name) === cp.key)
    if (!exists) d.accounts.push({ id: newId(), name: cp.name, balance: 0, asOf: '' })
    return d
  }
  const ids = new Set(cp.orphans.map((t) => t.id))
  for (const t of d.transactions) {
    if (!ids.has(t.id) || t.category !== INTERNAL) continue
    t.category = t.amount > 0 ? INCOME_CATEGORY : 'Transfer'
  }
  return d
}
