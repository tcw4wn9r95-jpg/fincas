// ── Saving an import ──────────────────────────────────────────────
// Lifted out of the import screen so it can be tested: four separate bugs in
// this logic duplicated or dropped whole months, and as component code none of
// them could be caught before they reached real data.
//
// The rules, each written down because each was once broken:
//  - A re-import replaces the picked account's lines for the months it
//    covers, and only that account's — a card and a current account share
//    months and must not evict each other.
//  - Rows the review folded in from what was saved replace themselves by id,
//    whatever account is picked by the time Save is pressed.
//  - A line this file carries that was saved earlier with no account is the
//    same line, and is replaced with it.
//  - Every import is recorded (`ImportBatch`) and its fresh lines carry its id,
//    so it can be shown, checked against its statement, and undone.

import type { AppData, ImportBatch, Transaction } from './types'

export const dupeKey = (t: Transaction) => `${t.date}|${t.amount}|${t.description}`

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The review's rows for the account now picked: whatever was folded in for a
 * previous pick goes, and the picked account's saved lines for the months this
 * file covers come in. Run whenever the picker changes, so what is on screen is
 * always exactly what Save will write — the gap between the two is what
 * doubled July.
 */
export function foldSaved(rows: Transaction[], saved: Transaction[], accountId: string): Transaction[] {
  const savedIds = new Set(saved.map((t) => t.id))
  const fresh = rows.filter((r) => !savedIds.has(r.id))
  const months = new Set(fresh.map((r) => r.month))
  const freshKeys = new Set(fresh.map(dupeKey))
  const folded = saved.filter(
    (t) => (accountId ? t.accountId === accountId : !t.accountId) && months.has(t.month) && !freshKeys.has(dupeKey(t)),
  )
  return [...fresh, ...folded].sort((a, b) => a.date.localeCompare(b.date))
}

export interface SaveImport {
  rows: Transaction[]
  accountId: string
  /** Money-date mode: the import replaces the months it covers. */
  replaceMonths: boolean
  /** Hand-logged lines this file brings in for real, dropped as it saves. */
  supersededIds: string[]
  files: string[]
  source?: ImportBatch['source']
  /** The statement's own period end, when it states one. */
  periodEnd?: string
  tieOut?: ImportBatch['tieOut']
  batchId: string
  at: string
}

export function saveImport(d: AppData, s: SaveImport): AppData {
  const savedIds = new Set(d.transactions.map((t) => t.id))
  // A freshly parsed line gets the picked account and this import's id. A row
  // folded in from what's saved keeps its own account — see `foldSaved`.
  const tagged = s.rows.map((r) => {
    if (savedIds.has(r.id)) return r
    return { ...r, accountId: r.accountId ?? (s.accountId || undefined), importId: s.batchId }
  })
  const fresh = tagged.filter((r) => !savedIds.has(r.id))
  const superseded = new Set(s.supersededIds)
  const resaved = new Set(tagged.map((r) => r.id))

  if (s.replaceMonths) {
    const months = new Set(tagged.map((r) => r.month))
    const incoming = new Set(tagged.map(dupeKey))
    const replaced = (t: Transaction) =>
      s.accountId ? t.accountId === s.accountId || (!t.accountId && incoming.has(dupeKey(t))) : !t.accountId
    d.transactions = [
      ...d.transactions.filter(
        (t) => !superseded.has(t.id) && !resaved.has(t.id) && !(months.has(t.month) && replaced(t)),
      ),
      ...tagged,
    ]
  } else {
    d.transactions = [...d.transactions.filter((t) => !superseded.has(t.id) && !resaved.has(t.id)), ...tagged]
  }

  if (fresh.length) {
    const dates = fresh.map((r) => r.date).sort()
    const batch: ImportBatch = {
      id: s.batchId,
      at: s.at,
      files: s.files,
      accountId: s.accountId || undefined,
      source: s.source,
      periodStart: dates[0],
      periodEnd: s.periodEnd && s.periodEnd > dates[dates.length - 1] ? s.periodEnd : dates[dates.length - 1],
      rows: fresh.length,
      total: round2(fresh.reduce((sum, r) => sum + r.amount, 0)),
      ...(s.tieOut ? { tieOut: s.tieOut } : {}),
    }
    d.imports = [...(d.imports ?? []), batch]
  }
  return d
}

/**
 * Take an import back: the lines it brought in go, and so does its record.
 * Lines it replaced on a re-import are not restored — they were superseded by
 * a fuller copy of the same statement, which is what is being removed.
 */
export function undoImport(d: AppData, batchId: string): AppData {
  d.transactions = d.transactions.filter((t) => t.importId !== batchId)
  d.imports = (d.imports ?? []).filter((b) => b.id !== batchId)
  return d
}
