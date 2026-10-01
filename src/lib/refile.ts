// ── Which account a line belongs to ───────────────────────────────
// A line's account decides what a card owes and which balance a statement
// moves, and for most of this household's history it was whatever the import
// picker happened to hold: 1,040 Revolut lines and 318 current-account lines
// sat on a credit card, which as a result read €52k in credit. The app capped
// that at zero, so the debt simply disappeared from every total.
//
// What a line's own shape says is far more reliable than that picker. A
// current-account statement prints every line behind a banking keyword
// ("DEBIT TPV …", "STANDING ORDER …", "CREDIT TRANSFER …"); a card statement
// prints the merchant alone; and every CSV this household has imported is a
// Revolut export. This proposes moves from those facts and never applies one
// unasked — the user sees what would move where, and says yes.

import type { Account, AppData, Transaction } from './types'
import { isCardAccount } from './forecast'

/** The opening words of a current-account statement line. */
const BANK_LINE =
  /^(direct debit|standing order|credit transfer|instant credit transfer|instant transfer|debit |cash |transfer|payment|interest|charges|fees|commission)/i

export const REVOLUT_NAME = 'Revolut'

export type LineKind = 'bank' | 'card' | 'revolut'

/** What a line looks like it came from, judged from its own text and file type. */
export function lineKind(t: Transaction): LineKind | undefined {
  if (t.source === 'csv') return 'revolut'
  if (t.source === 'pdf') return BANK_LINE.test(t.description.trim()) ? 'bank' : 'card'
  return undefined
}

export function revolutAccount(data: AppData): Account | undefined {
  return data.accounts.find((a) => !isCardAccount(a) && /revolut/i.test(a.name))
}

export function bankAccount(data: AppData): Account | undefined {
  return data.accounts.find((a) => a.tracked && !isCardAccount(a))
}

/**
 * The card that card-statement lines belong to when nothing says which: the
 * one already holding most of them. Card lines don't print the card number, so
 * a household with two cards can only be told apart by the statement they came
 * in on — which the import records, and old data doesn't.
 */
function mainCard(data: AppData): Account | undefined {
  const cards = data.accounts.filter(isCardAccount)
  if (cards.length <= 1) return cards[0]
  const count = new Map<string, number>()
  for (const t of data.transactions) {
    if (t.accountId && lineKind(t) === 'card') count.set(t.accountId, (count.get(t.accountId) ?? 0) + 1)
  }
  return cards.slice().sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0))[0]
}

export interface RefileMove {
  txId: string
  from?: string
  /** Account id, or `REVOLUT_NAME` when that account doesn't exist yet. */
  to: string
}

export interface RefileProposal {
  moves: RefileMove[]
  /** Moves per destination, with a few example lines, for the question. */
  summary: Array<{ to: string; toName: string; count: number; examples: string[] }>
  /** True when a Revolut account has to be created to receive its lines. */
  createsRevolut: boolean
}

const key = (t: Transaction) => `${t.date}|${t.amount}|${t.description}`

export function proposeRefile(data: AppData): RefileProposal {
  const bank = bankAccount(data)
  const revolut = revolutAccount(data)
  const card = mainCard(data)
  const cards = new Set(data.accounts.filter(isCardAccount).map((a) => a.id))
  // An untagged line with a tagged twin is a duplicate waiting for the
  // counted-twice question. Filing it would give both copies the same account,
  // and the pair would stop looking like a duplicate at all.
  const taggedLines = new Set(data.transactions.filter((t) => t.accountId).map(key))

  const moves: RefileMove[] = []
  for (const t of data.transactions) {
    const kind = lineKind(t)
    if (!kind) continue
    if (!t.accountId && taggedLines.has(key(t))) continue
    let to: string | undefined
    if (kind === 'revolut') to = revolut?.id ?? REVOLUT_NAME
    else if (kind === 'bank') to = bank?.id
    // A card line already on a card stays put: which of two cards it is can't
    // be read from the line, and a guess would only trade one error for another.
    else if (!t.accountId || !cards.has(t.accountId)) to = card?.id
    if (to && to !== t.accountId) moves.push({ txId: t.id, from: t.accountId, to })
  }

  const names = new Map(data.accounts.map((a) => [a.id, a.name]))
  const byTarget = new Map<string, RefileMove[]>()
  for (const m of moves) byTarget.set(m.to, [...(byTarget.get(m.to) ?? []), m])
  const txById = new Map(data.transactions.map((t) => [t.id, t]))
  const summary = [...byTarget.entries()].map(([to, ms]) => ({
    to,
    toName: names.get(to) ?? to,
    count: ms.length,
    examples: ms.slice(0, 3).map((m) => txById.get(m.txId)!.description),
  }))
  return { moves, summary, createsRevolut: moves.some((m) => m.to === REVOLUT_NAME) }
}

/** Apply a proposal, creating the Revolut account first if it needs one. */
export function applyRefile(d: AppData, proposal: RefileProposal, newId: () => string): AppData {
  let revolutId = revolutAccount(d)?.id
  if (proposal.createsRevolut && !revolutId) {
    revolutId = newId()
    // Not tracked: a Revolut export carries no statement balance this app
    // trusts, so its balance stays whatever the user types.
    d.accounts.push({ id: revolutId, name: REVOLUT_NAME, balance: 0, asOf: '' })
  }
  const byId = new Map(d.transactions.map((t) => [t.id, t]))
  for (const m of proposal.moves) {
    const t = byId.get(m.txId)
    if (!t) continue
    // Only if nothing moved it since the question was asked.
    if (t.accountId !== m.from) continue
    t.accountId = m.to === REVOLUT_NAME ? revolutId : m.to
  }
  return d
}
