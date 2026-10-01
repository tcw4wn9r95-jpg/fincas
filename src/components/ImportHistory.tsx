import { useData } from '../store'
import { undoImport } from '../lib/importer'
import { formatMoney } from '../lib/format'

/**
 * Every import, as the event it was: file, account, period, lines, and whether
 * the statement agreed with them. Newest first, each one undoable — an import
 * used to leave no trace but its lines, so a bad one could only be cleaned up
 * line by line.
 */
export function ImportHistory() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fx = (n: number) => formatMoney(n, currency, locale)
  const names = new Map(data.accounts.map((a) => [a.id, a.name]))
  const batches = (data.imports ?? []).slice().reverse()
  if (!batches.length) return null

  function undo(id: string, rows: number) {
    const left = data.transactions.filter((t) => t.importId === id).length
    if (!confirm(`Remove the ${left} line${left === 1 ? '' : 's'} this import brought in?${left !== rows ? ` (It brought ${rows}; the rest were already removed or replaced.)` : ''}`)) return
    update((d) => undoImport(d, id))
  }

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h3 className="text-lg">Imports</h3>
        <p className="text-sm text-muted">Each statement you've brought in, and whether its own balances agreed.</p>
      </div>
      <ul className="divide-y divide-line">
        {batches.map((b) => (
          <li key={b.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className="font-medium break-words">{b.files.join(', ') || 'Import'}</p>
              <p className="text-muted text-xs mt-0.5">
                {new Date(b.at).toLocaleDateString(locale)} · {b.accountId ? names.get(b.accountId) ?? 'a deleted account' : 'no account'} ·{' '}
                {b.periodStart} to {b.periodEnd} · {b.rows} lines · {fx(b.total)}
              </p>
              {b.tieOut?.agrees === true && <p className="text-xs text-forest mt-0.5">✓ Matched its statement</p>}
              {b.tieOut?.agrees === false && (
                <p className="text-xs text-clay mt-0.5">✗ Off from its statement by {fx(b.tieOut.difference ?? 0)}</p>
              )}
            </div>
            <button className="btn-subtle text-xs shrink-0" onClick={() => undo(b.id, b.rows)}>
              Undo
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
