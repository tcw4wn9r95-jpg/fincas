import { useRef, useState } from 'react'
import { useData } from '../store'
import { parseFile } from '../lib/parse'
import { CATEGORIES } from '../lib/categorize'
import { formatMoney, classNames } from '../lib/format'
import type { Transaction } from '../lib/types'
import { IconClose, IconUpload, IconTrash } from './icons'

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Transaction[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')

  async function onPick(file: File) {
    setBusy(true)
    setWarnings([])
    setFileName(file.name)
    try {
      const res = await parseFile(file)
      setRows(res.transactions)
      setWarnings(res.warnings)
    } catch (err) {
      setWarnings([err instanceof Error ? err.message : 'Could not read that file.'])
      setRows([])
    } finally {
      setBusy(false)
    }
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

  function save() {
    if (!rows.length) return
    update((d) => {
      d.transactions = [...d.transactions, ...rows]
      // Learn any new categories into the budget map silently? No — keep budgets explicit.
      return d
    })
    onClose()
  }

  const inCount = rows.filter((r) => r.amount >= 0).length
  const outCount = rows.length - inCount

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
      <div className="bg-paper w-full sm:max-w-3xl sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div>
            <h2 className="text-xl">Import a statement</h2>
            <p className="text-sm text-muted">CSV or PDF — parsed privately on your device</p>
          </div>
          <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {rows.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-line rounded-xl2 py-12 flex flex-col items-center gap-3 text-muted hover:border-forest hover:text-forest hover:bg-forest-tint/40 transition"
            >
              <IconUpload width={32} height={32} />
              <div className="font-medium text-ink">
                {busy ? 'Reading…' : 'Choose a CSV or PDF statement'}
              </div>
              <div className="text-sm">Your bank export or monthly statement</div>
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="text-sm text-muted">
                  <span className="text-ink font-medium">{rows.length}</span> rows from{' '}
                  <span className="text-ink">{fileName}</span> · {inCount} in · {outCount} out
                </div>
                <button className="btn-subtle text-xs" onClick={flipAll}>
                  Flip all signs
                </button>
              </div>
              <div className="border border-line rounded-xl overflow-hidden">
                <div className="max-h-[44vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-canvas">
                      <tr className="text-left text-muted border-b border-line">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 font-medium">Category</th>
                        <th className="px-3 py-2 font-medium text-right">Amount</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b border-line/60">
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted">{r.date}</td>
                          <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.description}>
                            {r.description}
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
                            <button
                              className="text-muted hover:text-clay"
                              onClick={() => remove(r.id)}
                              aria-label="Remove"
                            >
                              <IconTrash width={16} height={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
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
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
