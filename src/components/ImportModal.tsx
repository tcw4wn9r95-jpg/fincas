import { useMemo, useRef, useState } from 'react'
import { useData } from '../store'
import { parseFile } from '../lib/parse'
import { CATEGORIES, matchRule } from '../lib/categorize'
import { formatMoney, classNames, uid } from '../lib/format'
import type { Transaction } from '../lib/types'
import { IconClose, IconUpload, IconTrash, IconTag } from './icons'
import { RuleModal } from './RuleModal'
import { Portal } from './Portal'

// Exact duplicates (date+amount+description) are skipped on import. These helpers
// catch the softer case: same date and amount, description merely similar — e.g.
// a pending charge re-posted as settled with a tweaked label. We flag, never drop.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function similarDesc(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 4 && nb.includes(na)) return true
  if (nb.length >= 4 && na.includes(nb)) return true
  const tb = new Set(nb.split(' ').filter((w) => w.length >= 4))
  for (const w of na.split(' ')) if (w.length >= 4 && tb.has(w)) return true
  return false
}

interface ImportModalProps {
  onClose: () => void
  title?: string
  subtitle?: string
  /** When provided, receives the reviewed rows instead of the default
   *  save-into-money-date behaviour (used by the weekly check-in). */
  onImport?: (rows: Transaction[]) => void
  /** Already-saved transactions for this stream, used to skip re-imports so you
   *  can add statements one at a time without double-counting overlaps. */
  existing?: Transaction[]
}

const dupeKey = (t: Transaction) => `${t.date}|${t.amount}|${t.description}`

export function ImportModal({ onClose, title, subtitle, onImport, existing }: ImportModalProps) {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Transaction[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [teaching, setTeaching] = useState<Transaction | null>(null)

  const savedStream = existing ?? data.transactions

  // Save a taught rule and apply it to every matching row on screen, so the
  // lesson takes effect now and on every future import.
  function saveRule(match: string, category: string) {
    const m = match.trim()
    if (m) {
      update((d) => {
        d.categoryRules = [...(d.categoryRules ?? []), { id: uid(), match: m, category }]
        return d
      })
      const needle = m.toLowerCase()
      setRows((prev) =>
        prev.map((r) => (r.description.toLowerCase().includes(needle) ? { ...r, category } : r)),
      )
    }
    setTeaching(null)
  }

  // Parse one or several files and merge them into the review. Rows matching what
  // you've already saved or staged are skipped, so re-adding an overlapping
  // statement won't double-count. Rows are only checked against that pre-existing
  // set — never against each other in this same batch — so two genuinely distinct
  // charges with the same date/amount/label inside one statement are both kept
  // (the soft "possible duplicate" flag surfaces them for a look instead).
  async function onPick(picked: File[]) {
    if (!picked.length) return
    setBusy(true)
    const seen = new Set<string>([...savedStream.map(dupeKey), ...rows.map(dupeKey)])
    const added: Transaction[] = []
    const warns: string[] = []
    const names: string[] = []
    let skipped = 0
    for (const file of picked) {
      names.push(file.name)
      try {
        const res = await parseFile(file)
        for (const w of res.warnings) warns.push(`${file.name}: ${w}`)
        for (const t of res.transactions) {
          if (seen.has(dupeKey(t))) {
            skipped++
            continue
          }
          // Your taught rules win over the automatic guess.
          const learned = matchRule(t.description, data.categoryRules)
          added.push(learned ? { ...t, category: learned } : t)
        }
      } catch (err) {
        warns.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be read'}`)
      }
    }
    if (skipped) warns.unshift(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} already imported.`)
    if (!added.length && !warns.length) warns.push('No new transactions found in that file.')
    setRows((prev) => [...prev, ...added])
    setFiles((prev) => [...prev, ...names])
    setWarnings(warns)
    setBusy(false)
  }

  function patch(id: string, fields: Partial<Transaction>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)))
  }
  function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }
  function flipAll() {
    setRows((prev) => prev.map((r) => ({ ...r, amount: -r.amount })))
  }

  // Rows that look like a possible re-post of something already saved, or of
  // another staged row: same date and amount, similar (not identical) label.
  const suspectIds = useMemo(() => {
    const flagged = new Set<string>()
    const savedByDA = new Map<string, string[]>()
    for (const t of savedStream) {
      const k = `${t.date}|${t.amount}`
      const list = savedByDA.get(k)
      if (list) list.push(t.description)
      else savedByDA.set(k, [t.description])
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const against = savedByDA.get(`${r.date}|${r.amount}`) ?? []
      let hit = against.some((d) => d !== r.description && similarDesc(d, r.description))
      if (!hit) {
        for (let j = 0; j < rows.length; j++) {
          if (j === i) continue
          const o = rows[j]
          if (
            o.date === r.date &&
            o.amount === r.amount &&
            o.description !== r.description &&
            similarDesc(o.description, r.description)
          ) {
            hit = true
            break
          }
        }
      }
      if (hit) flagged.add(r.id)
    }
    return flagged
  }, [rows, savedStream])

  function removeSuspects() {
    setRows((prev) => prev.filter((r) => !suspectIds.has(r.id)))
  }

  function save() {
    if (!rows.length) return
    if (onImport) {
      onImport(rows)
    } else {
      update((d) => {
        d.transactions = [...d.transactions, ...rows]
        // Learn any new categories into the budget map silently? No — keep budgets explicit.
        return d
      })
    }
    onClose()
  }

  const inCount = rows.filter((r) => r.amount >= 0).length
  const outCount = rows.length - inCount

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
      <div className="bg-paper w-full sm:max-w-3xl sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div>
            <h2 className="text-xl">{title ?? 'Import a statement'}</h2>
            <p className="text-sm text-muted">
              {subtitle ?? 'CSV or PDF — parsed privately on your device'}
            </p>
          </div>
          <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {rows.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-line rounded-xl2 py-12 flex flex-col items-center gap-3 text-muted hover:border-forest hover:text-forest hover:bg-forest-tint/40 transition"
            >
              <IconUpload width={32} height={32} />
              <div className="font-medium text-ink">
                {busy ? 'Reading…' : 'Choose CSV or PDF statements'}
              </div>
              <div className="text-sm">
                Pick one or several — you can add more before saving, or come back anytime
              </div>
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="text-sm text-muted">
                  <span className="text-ink font-medium">{rows.length}</span> rows from{' '}
                  <span className="text-ink">
                    {files.length} {files.length === 1 ? 'file' : 'files'}
                  </span>{' '}
                  · {inCount} in · {outCount} out
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn-subtle text-xs inline-flex items-center gap-1"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                  >
                    <IconUpload width={13} height={13} /> {busy ? 'Reading…' : 'Add more files'}
                  </button>
                  <button className="btn-subtle text-xs" onClick={flipAll}>
                    Flip all signs
                  </button>
                </div>
              </div>

              {suspectIds.size > 0 && (
                <div className="mb-3 rounded-lg bg-gold/10 border border-gold/30 px-4 py-2.5 text-sm flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink/80">
                    {suspectIds.size} row{suspectIds.size === 1 ? '' : 's'} look like possible
                    duplicates — same date and amount as something already imported, with a
                    similar name. Check the highlighted rows.
                  </span>
                  <button className="btn-subtle text-xs shrink-0" onClick={removeSuspects}>
                    Remove {suspectIds.size === 1 ? 'it' : 'them'}
                  </button>
                </div>
              )}
              <div className="border border-line rounded-xl overflow-hidden">
                <div>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-canvas z-10">
                      <tr className="text-left text-muted border-b border-line">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 font-medium">Category</th>
                        <th className="px-3 py-2 font-medium text-right">Amount</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const suspect = suspectIds.has(r.id)
                        return (
                        <tr
                          key={r.id}
                          className={classNames('border-b border-line/60', suspect && 'bg-gold/10')}
                        >
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted">{r.date}</td>
                          <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.description}>
                            {r.description}
                            {suspect && (
                              <span className="ml-1.5 pill bg-gold/20 text-ink/70 align-middle">
                                possible duplicate
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              className="bg-transparent text-sm outline-none cursor-pointer hover:text-forest"
                              value={r.category}
                              onChange={(e) => patch(r.id, { category: e.target.value })}
                            >
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td
                            className={classNames(
                              'px-3 py-1.5 text-right font-medium tabular-nums',
                              r.amount >= 0 ? 'text-forest' : 'text-clay',
                            )}
                          >
                            <button
                              onClick={() => patch(r.id, { amount: -r.amount })}
                              title="Click to flip sign"
                              className="hover:underline"
                            >
                              {formatMoney(r.amount, currency, locale, { signed: true })}
                            </button>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                className="text-muted hover:text-forest"
                                onClick={() => setTeaching(r)}
                                title="Teach a rule from this row"
                                aria-label="Teach a rule"
                              >
                                <IconTag width={15} height={15} />
                              </button>
                              <button
                                className="text-muted hover:text-clay"
                                onClick={() => remove(r.id)}
                                aria-label="Remove"
                              >
                                <IconTrash width={16} height={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {warnings.length > 0 && (
            <div className="mt-4 rounded-lg bg-gold/10 border border-gold/30 px-4 py-3 text-sm text-ink/80">
              {warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={!rows.length}>
            Save {rows.length || ''} transactions
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            if (picked.length) onPick(picked)
            e.target.value = ''
          }}
        />
      </div>

      {teaching && (
        <RuleModal
          description={teaching.description}
          initialCategory={teaching.category}
          matchCount={(m) =>
            rows.filter((r) => m.trim() && r.description.toLowerCase().includes(m.trim().toLowerCase())).length
          }
          onCancel={() => setTeaching(null)}
          onSave={saveRule}
        />
      )}
    </div>
    </Portal>
  )
}
