import { useMemo, useState } from 'react'
import { formatMoney, classNames, parseAmount } from '../lib/format'
import {
  provisionRoleFor,
  suggestProvisionAmount,
  transactionAllocations,
  type ProvisionStatus,
} from '../lib/provisions'
import type { ProvisionAllocation, Transaction } from '../lib/types'
import { unallocatedAmount } from '../lib/provisions'
import { IconClose, IconProvision } from './icons'
import { Portal } from './Portal'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The card-level entry point to `ProvisionModal`: one button, plus a read-out
 * of how this transaction is currently split. `compact` drops the chips for
 * tight single-line rows, keeping the state in the button label and tooltip.
 */
export function ProvisionButton({
  tx,
  provisions,
  currency,
  locale,
  onOpen,
  compact,
}: {
  tx: Transaction
  provisions: ProvisionStatus[]
  currency: string
  locale: string
  onOpen: () => void
  compact?: boolean
}) {
  const labels = new Map(provisions.map((p) => [p.id, p.label]))
  const allocs = transactionAllocations(tx).filter((a) => labels.has(a.provisionId))
  const left = unallocatedAmount(tx)
  const fx = (n: number) => formatMoney(n, currency, locale)
  const summary = allocs.map((a) => `${labels.get(a.provisionId)}: ${fx(a.amount)}`).join(' · ')

  return (
    <div className={classNames('flex items-center gap-2 min-w-0', !compact && 'flex-wrap')}>
      <button
        className={classNames(
          'btn-subtle text-xs shrink-0 inline-flex items-center gap-1.5',
          allocs.length > 0 && 'text-forest',
        )}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        title={allocs.length ? summary : 'Allocate this transaction to your provisions'}
      >
        <IconProvision width={14} height={14} />
        {allocs.length ? `Provisioned${compact ? ` (${allocs.length})` : ''}` : 'Provision'}
      </button>
      {!compact &&
        allocs.map((a) => (
          <span key={a.provisionId} className="pill bg-forest-tint text-forest">
            {labels.get(a.provisionId)} {fx(a.amount)}
          </span>
        ))}
      {!compact && allocs.length > 0 && left > 0.005 && (
        <span className="text-xs text-muted tabular-nums">{fx(left)} left</span>
      )}
    </div>
  )
}

/**
 * Split one transaction across provision buckets. A €1,000 transfer is rarely
 * for a single pot — put €500 toward taxes and €300 toward the car, and the
 * remaining €200 stays visibly unallocated rather than being silently swept
 * into whichever provision was picked last.
 *
 * Each row's role is decided by the provision it belongs to: a transaction in
 * the provision's own category is the real bill landing (drawdown), anything
 * else is money being set aside for it (contribution).
 */
export function ProvisionModal({
  tx,
  provisions,
  currency,
  locale,
  onSave,
  onClose,
}: {
  tx: Transaction
  provisions: ProvisionStatus[]
  currency: string
  locale: string
  onSave: (allocations: ProvisionAllocation[]) => void
  onClose: () => void
}) {
  const total = round2(Math.abs(tx.amount))

  // Amounts as raw input strings so a half-typed "1." doesn't fight the user.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const a of transactionAllocations(tx)) initial[a.provisionId] = String(a.amount)
    return initial
  })

  const allocated = useMemo(
    () =>
      round2(
        provisions.reduce((s, p) => {
          const n = parseAmount(amounts[p.id] ?? '')
          return s + (Number.isFinite(n) ? Math.max(0, n) : 0)
        }, 0),
      ),
    [amounts, provisions],
  )
  const remaining = round2(total - allocated)
  const over = remaining < -0.005
  const pct = total > 0 ? Math.min(100, Math.round((allocated / total) * 100)) : 0

  const fx = (n: number) => formatMoney(n, currency, locale)

  function setAmount(id: string, value: string) {
    setAmounts((prev) => ({ ...prev, [id]: value }))
  }

  /** Fill a row with everything still unallocated (on top of what it already holds). */
  function useRest(id: string) {
    const current = Math.max(0, parseAmount(amounts[id] ?? '') || 0)
    setAmount(id, String(round2(current + Math.max(0, remaining))))
  }

  /** Pre-fill a row with what this provision actually needs, capped by what's left. */
  function suggest(p: ProvisionStatus) {
    setAmount(p.id, String(suggestProvisionAmount(tx, p, Math.max(0, remaining))))
  }

  function save() {
    const next: ProvisionAllocation[] = []
    for (const p of provisions) {
      const amount = round2(Math.max(0, parseAmount(amounts[p.id] ?? '') || 0))
      if (amount <= 0) continue
      next.push({ provisionId: p.id, amount, role: provisionRoleFor(tx.category, p) })
    }
    onSave(next)
    onClose()
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
        <div className="bg-paper w-full sm:max-w-lg sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[94vh] flex flex-col">
          <div className="px-6 py-4 border-b border-line">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl">Provision this transaction</h2>
                <p className="text-sm text-muted break-words">{tx.description}</p>
              </div>
              <button className="btn-subtle p-2 shrink-0" onClick={onClose} aria-label="Close">
                <IconClose />
              </button>
            </div>

            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <div className="label">Transaction</div>
                <div className="tabular-nums font-medium">{fx(total)}</div>
              </div>
              <div className="text-center">
                <div className="label">Allocated</div>
                <div className="tabular-nums font-medium">{fx(allocated)}</div>
              </div>
              <div className="text-right">
                <div className="label">Left to allocate</div>
                <div
                  className={classNames(
                    'tabular-nums font-medium text-lg',
                    over ? 'text-clay' : remaining < 0.005 ? 'text-forest' : 'text-gold',
                  )}
                >
                  {fx(Math.abs(remaining))}
                </div>
              </div>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className={classNames('h-full rounded-full transition-all', over ? 'bg-clay' : 'bg-forest')}
                style={{ width: `${over ? 100 : pct}%` }}
              />
            </div>
            {over && (
              <p className="text-xs text-clay mt-2">
                That's {fx(Math.abs(remaining))} more than this transaction — trim a bucket before saving.
              </p>
            )}
          </div>

          <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-2.5">
            {provisions.length === 0 && (
              <p className="text-center text-muted py-8">
                No provisions yet — create one in your plan first.
              </p>
            )}
            {provisions.map((p) => {
              const raw = amounts[p.id] ?? ''
              const value = Math.max(0, parseAmount(raw) || 0)
              const active = value > 0
              const role = provisionRoleFor(tx.category, p)
              return (
                <div
                  key={p.id}
                  className={classNames(
                    'rounded-xl border p-3.5 transition',
                    active ? 'border-forest/40 bg-forest-tint/20' : 'border-line',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.label}</div>
                      <div className="text-xs text-muted">
                        {fx(p.funded)} of {fx(p.targetAmount)} set aside
                        {p.suggestedMonthly ? ` · ${fx(p.suggestedMonthly)}/mo suggested` : ''}
                      </div>
                    </div>
                    <span
                      className={classNames(
                        'pill shrink-0',
                        role === 'drawdown' ? 'bg-gold/15 text-gold' : 'bg-forest-tint text-forest',
                      )}
                      title={
                        role === 'drawdown'
                          ? `This is the ${p.category} bill itself — it draws the pot down`
                          : 'Money set aside into this pot'
                      }
                    >
                      {role === 'drawdown' ? 'Draws down' : 'Sets aside'}
                    </span>
                  </div>

                  <div className="mt-2 h-1 rounded-full bg-line overflow-hidden">
                    <div className="h-full bg-forest/40 rounded-full" style={{ width: `${p.pct}%` }} />
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input py-1.5 flex-1 min-w-0 text-right tabular-nums"
                      placeholder="0.00"
                      value={raw}
                      onChange={(e) => setAmount(p.id, e.target.value)}
                      aria-label={`Amount for ${p.label}`}
                    />
                    <button
                      className="btn-subtle text-xs shrink-0"
                      onClick={() => suggest(p)}
                      title="Fill with what this provision needs, capped by what's left"
                    >
                      Suggest
                    </button>
                    <button
                      className="btn-subtle text-xs shrink-0"
                      onClick={() => useRest(p.id)}
                      disabled={remaining <= 0.005}
                      title="Put everything still unallocated here"
                    >
                      Use rest
                    </button>
                    {active && (
                      <button
                        className="btn-subtle p-1.5 text-muted hover:text-clay shrink-0"
                        onClick={() => setAmount(p.id, '')}
                        aria-label={`Clear ${p.label}`}
                        title="Clear"
                      >
                        <IconClose width={14} height={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-line">
            <button className="btn-subtle text-xs" onClick={() => setAmounts({})}>
              Clear all
            </button>
            <div className="flex items-center gap-3">
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={over}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}
