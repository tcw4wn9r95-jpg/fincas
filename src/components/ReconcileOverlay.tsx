import { useMemo } from 'react'
import { CATEGORIES } from '../lib/categorize'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'
import type { Transaction } from '../lib/types'
import { IconClose, IconCheck, IconSparkle } from './icons'
import { Portal } from './Portal'

/**
 * A Xero-style reconcile screen: go through a month's transactions, confirm the
 * suggested category or correct it (which teaches a rule), and mark each done.
 * As rules accumulate, more lines arrive already categorised, so each month
 * there's less to touch.
 */
export function ReconcileOverlay({
  month,
  txs,
  currency,
  locale,
  onSetCategory,
  onToggle,
  onConfirmAll,
  onAiCategorize,
  aiBusy,
  aiError,
  onClose,
}: {
  month: string
  txs: Transaction[]
  currency: string
  locale: string
  onSetCategory: (id: string, category: string) => void
  onToggle: (id: string, reconciled: boolean) => void
  onConfirmAll: () => void
  onAiCategorize?: () => void
  aiBusy?: boolean
  aiError?: string
  onClose: () => void
}) {
  // Needs-attention first (unreconciled, Other on top), then the rest by date.
  const ordered = useMemo(() => {
    const rank = (t: Transaction) => (t.reconciled ? 2 : t.category === 'Other' ? 0 : 1)
    return txs.slice().sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date))
  }, [txs])
  const done = txs.filter((t) => t.reconciled).length
  const total = txs.length
  const suggestable = txs.filter((t) => !t.reconciled && t.category !== 'Other').length
  const unreconciled = total - done
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
        <div className="bg-paper w-full sm:max-w-xl sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[94vh] flex flex-col">
          <div className="px-6 py-4 border-b border-line">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl">Reconcile {formatMonthLabel(month + '-01', locale)}</h2>
                <p className="text-sm text-muted">
                  {done} of {total} reconciled
                </p>
              </div>
              <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
                <IconClose />
              </button>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden">
              <div className="h-full bg-forest rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {onAiCategorize && unreconciled > 0 && (
                <button
                  className="btn-ghost text-sm inline-flex items-center gap-1.5"
                  onClick={onAiCategorize}
                  disabled={aiBusy}
                  title="Suggest categories from your history with Claude"
                >
                  <IconSparkle width={15} height={15} />
                  {aiBusy ? 'Thinking…' : 'Auto-categorize with AI'}
                </button>
              )}
              {suggestable > 0 && (
                <button className="btn-ghost text-sm inline-flex items-center gap-1.5" onClick={onConfirmAll}>
                  <IconCheck width={15} height={15} /> Confirm {suggestable} suggestion
                  {suggestable === 1 ? '' : 's'}
                </button>
              )}
            </div>
            {aiError && <p className="text-xs text-clay mt-2">{aiError}</p>}
          </div>

          <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-2.5">
            {ordered.length === 0 && (
              <p className="text-center text-muted py-10">No transactions for this month.</p>
            )}
            {ordered.map((t) => {
              const isOther = t.category === 'Other'
              return (
                <div
                  key={t.id}
                  className={classNames(
                    'rounded-xl border p-3.5 transition',
                    t.reconciled ? 'border-line bg-forest-tint/20 opacity-70' : 'border-line',
                    isOther && !t.reconciled && 'border-gold/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-xs text-muted">
                      {new Date(t.date + 'T00:00:00').toLocaleDateString(locale, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <span
                      className={classNames(
                        'tabular-nums font-medium shrink-0',
                        t.amount >= 0 ? 'text-forest' : 'text-clay',
                      )}
                    >
                      {formatMoney(t.amount, currency, locale, { signed: true })}
                    </span>
                  </div>
                  <p className="text-sm text-ink break-words mb-3 leading-relaxed">{t.description}</p>
                  <div className="flex items-center gap-2">
                    <select
                      className={classNames(
                        'input py-1.5 flex-1 min-w-0',
                        isOther && !t.reconciled && 'text-clay',
                      )}
                      value={t.category}
                      onChange={(e) => onSetCategory(t.id, e.target.value)}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {t.reconciled ? (
                      <button
                        className="btn-subtle text-forest inline-flex items-center gap-1 shrink-0"
                        onClick={() => onToggle(t.id, false)}
                        title="Un-reconcile"
                      >
                        <IconCheck width={15} height={15} /> Reconciled
                      </button>
                    ) : (
                      <button
                        className="btn-primary inline-flex items-center gap-1 shrink-0"
                        onClick={() => onToggle(t.id, true)}
                        disabled={isOther}
                        title={isOther ? 'Pick a category first' : 'Confirm'}
                      >
                        <IconCheck width={15} height={15} /> OK
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
