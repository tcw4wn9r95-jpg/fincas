import { useMemo, useState } from 'react'
import { formatMoney, classNames, parseAmount } from '../lib/format'
import {
  provisionRoleFor,
  suggestProvisionAmount,
  transactionAllocations,
  unallocatedAmount,
  EMERGENCY_FUND_ID,
  EMERGENCY_FUND_LABEL,
  type EmergencyFundStatus,
  type ProvisionStatus,
} from '../lib/provisions'
import type { ProvisionAllocation, Transaction } from '../lib/types'
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
  const labels = new Map<string, string>([
    ...provisions.map((p) => [p.id, p.label] as const),
    [EMERGENCY_FUND_ID, EMERGENCY_FUND_LABEL],
  ])
  const allocs = transactionAllocations(tx).filter((a) => labels.has(a.provisionId))
  const left = unallocatedAmount(tx)
  const fx = (n: number) => formatMoney(n, currency, locale)
  const summary = allocs
    .map(
      (a) =>
        `${a.role === 'drawdown' ? 'From' : 'Into'} ${labels.get(a.provisionId)}: ${fx(a.amount)}`,
    )
    .join(' · ')

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
          <span
            key={a.provisionId}
            className={classNames(
              'pill',
              a.role === 'drawdown' ? 'bg-gold/15 text-gold' : 'bg-forest-tint text-forest',
            )}
          >
            {a.role === 'drawdown' ? '−' : ''}
            {fx(a.amount)} {a.role === 'drawdown' ? 'from' : 'to'} {labels.get(a.provisionId)}
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
  emergency,
}: {
  tx: Transaction
  provisions: ProvisionStatus[]
  currency: string
  locale: string
  onSave: (allocations: ProvisionAllocation[]) => void
  onClose: () => void
  emergency: EmergencyFundStatus
}) {
  const total = round2(Math.abs(tx.amount))

  // A closed provision is done with — hide it from new allocations, but keep
  // showing one this transaction is already split against so that split stays
  // visible and editable rather than silently disappearing.
  const allocatable = useMemo(() => {
    const already = new Set(transactionAllocations(tx).map((a) => a.provisionId))
    return provisions.filter((p) => !p.closedAt || already.has(p.id))
  }, [provisions, tx])

  // Amounts as raw input strings so a half-typed "1." doesn't fight the user.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const a of transactionAllocations(tx)) initial[a.provisionId] = String(a.amount)
    return initial
  })
  /**
   * Which way the money moves. One transaction is either putting money into
   * savings or taking it out — mixing both in a single line makes no sense —
   * so this is chosen once for the whole split rather than guessed per row.
   *
   * The guess is only a starting point: a bill in a provision's own category
   * is obviously that pot being spent, and anything else is assumed to be a
   * set-aside. That inference was previously the *only* answer, which quietly
   * got it wrong whenever savings paid for something filed under a different
   * category — a laptop bought out of the emergency fund read as money going in.
   */
  const [direction, setDirection] = useState<'contribution' | 'drawdown'>(() => {
    const existing = transactionAllocations(tx)[0]
    if (existing) return existing.role
    return allocatable.some((p) => provisionRoleFor(tx.category, p) === 'drawdown')
      ? 'drawdown'
      : 'contribution'
  })
  const pulling = direction === 'drawdown'

  const rowIds = useMemo(() => [...allocatable.map((p) => p.id), EMERGENCY_FUND_ID], [allocatable])
  const allocated = useMemo(
    () =>
      round2(
        rowIds.reduce((s, id) => {
          const n = parseAmount(amounts[id] ?? '')
          return s + (Number.isFinite(n) ? Math.max(0, n) : 0)
        }, 0),
      ),
    [amounts, rowIds],
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

  /** Pre-fill a row with what this provision needs (or holds), capped by what's left. */
  function suggest(p: ProvisionStatus) {
    setAmount(p.id, String(suggestProvisionAmount(tx, p, Math.max(0, remaining), direction)))
  }

  function save() {
    const next: ProvisionAllocation[] = []
    for (const p of allocatable) {
      const amount = round2(Math.max(0, parseAmount(amounts[p.id] ?? '') || 0))
      if (amount <= 0) continue
      next.push({ provisionId: p.id, amount, role: direction })
    }
    const toFund = round2(Math.max(0, parseAmount(amounts[EMERGENCY_FUND_ID] ?? '') || 0))
    if (toFund > 0) next.push({ provisionId: EMERGENCY_FUND_ID, amount: toFund, role: direction })
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

            <div className="mt-4 grid grid-cols-2 gap-1 p-1 bg-canvas rounded-xl border border-line">
              {(
                [
                  ['contribution', 'Set aside', 'Money going into your pots'],
                  ['drawdown', 'Pull from savings', 'This was paid for out of a pot'],
                ] as const
              ).map(([d, title, hint]) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={classNames(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    direction === d ? 'bg-forest text-paper' : 'text-muted hover:text-ink',
                  )}
                  title={hint}
                >
                  {title}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted mt-2">
              {pulling
                ? `Reduces the pots below by what you take out. ${tx.category} stays the reason for the spend — this only says where the money came from.`
                : 'Adds to the pots below, saving up for what they’re for.'}
            </p>

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
            {allocatable.length === 0 && (
              <p className="text-center text-muted text-sm py-4">
                No provisions yet — add one in your plan, or send this to the emergency fund.
              </p>
            )}
            {allocatable.map((p) => {
              const raw = amounts[p.id] ?? ''
              const value = Math.max(0, parseAmount(raw) || 0)
              const active = value > 0
              // Taking out more than the pot holds isn't blocked — it happened,
              // and the plan already reports the shortfall — but say so here.
              const overdrawing = pulling && value > p.funded + 0.005
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
                        {pulling
                          ? `${fx(p.funded)} available`
                          : `${fx(p.funded)} of ${fx(p.targetAmount)} set aside`}
                        {!pulling && p.suggestedMonthly ? ` · ${fx(p.suggestedMonthly)}/mo suggested` : ''}
                      </div>
                    </div>
                    <span
                      className={classNames(
                        'pill shrink-0',
                        pulling ? 'bg-gold/15 text-gold' : 'bg-forest-tint text-forest',
                      )}
                    >
                      {pulling ? 'Takes out' : 'Sets aside'}
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
                      title={
                        pulling
                          ? "Fill with what this pot can cover, capped by what's left"
                          : "Fill with what this provision needs, capped by what's left"
                      }
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
                  {overdrawing && (
                    <p className="text-xs text-clay mt-2">
                      {fx(value - p.funded)} more than this pot holds — the rest came from somewhere
                      else.
                    </p>
                  )}
                </div>
              )
            })}

            {/* The catch-all, pinned below the named pots: anything not earmarked
                for a specific bill belongs here rather than nowhere. */}
            {(() => {
              const raw = amounts[EMERGENCY_FUND_ID] ?? ''
              const value = Math.max(0, parseAmount(raw) || 0)
              const active = value > 0
              const overdrawing = pulling && value > emergency.balance + 0.005
              return (
                <div
                  className={classNames(
                    'rounded-xl border p-3.5 transition border-dashed',
                    active ? 'border-forest/50 bg-forest-tint/20' : 'border-line',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{EMERGENCY_FUND_LABEL}</div>
                      <div className="text-xs text-muted">
                        {pulling ? (
                          `${fx(emergency.balance)} available`
                        ) : (
                          <>
                            {fx(emergency.balance)}
                            {emergency.targetAmount > 0 ? ` of ${fx(emergency.targetAmount)}` : ''} saved
                            {' · '}for whatever isn't earmarked
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={classNames(
                        'pill shrink-0',
                        pulling ? 'bg-gold/15 text-gold' : 'bg-forest-tint text-forest',
                      )}
                    >
                      {pulling ? 'Takes out' : 'Sets aside'}
                    </span>
                  </div>

                  {emergency.targetAmount > 0 && (
                    <div className="mt-2 h-1 rounded-full bg-line overflow-hidden">
                      <div
                        className="h-full bg-forest/40 rounded-full"
                        style={{ width: `${emergency.pct}%` }}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input py-1.5 flex-1 min-w-0 text-right tabular-nums"
                      placeholder="0.00"
                      value={raw}
                      onChange={(e) => setAmount(EMERGENCY_FUND_ID, e.target.value)}
                      aria-label={`Amount for ${EMERGENCY_FUND_LABEL}`}
                    />
                    <button
                      className="btn-subtle text-xs shrink-0"
                      onClick={() => useRest(EMERGENCY_FUND_ID)}
                      disabled={remaining <= 0.005}
                      title={
                        pulling
                          ? 'Cover everything still unallocated from the emergency fund'
                          : 'Sweep everything still unallocated into the emergency fund'
                      }
                    >
                      {pulling ? 'Cover the rest' : 'Sweep the rest'}
                    </button>
                    {active && (
                      <button
                        className="btn-subtle p-1.5 text-muted hover:text-clay shrink-0"
                        onClick={() => setAmount(EMERGENCY_FUND_ID, '')}
                        aria-label={`Clear ${EMERGENCY_FUND_LABEL}`}
                        title="Clear"
                      >
                        <IconClose width={14} height={14} />
                      </button>
                    )}
                  </div>
                  {overdrawing && (
                    <p className="text-xs text-clay mt-2">
                      {fx(value - emergency.balance)} more than the fund holds — the rest came from
                      somewhere else.
                    </p>
                  )}
                </div>
              )
            })()}
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
