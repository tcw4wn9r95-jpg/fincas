import { useMemo, useState } from 'react'
import { CARD_PAYMENT_CATEGORY, CATEGORIES } from '../lib/categorize'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'
import { transactionAllocations, type ProvisionStatus } from '../lib/provisions'
import type { Account, EventExpense, SpecialEvent, Transaction } from '../lib/types'
import { IconClose, IconCheck, IconSparkle, IconHelp } from './icons'
import { Markdown } from './Markdown'
import type { StreamHandlers } from '../lib/claude'
import { Portal } from './Portal'
import { CardPicker } from './CardPicker'
import { ProvisionButton } from './ProvisionModal'

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
  provisions,
  cards,
  events,
  onSetCategory,
  onSetCard,
  eventQuestion,
  onAnswerEventQuestion,
  onToggle,
  onConfirmAll,
  onAiCategorize,
  onProvision,
  onAskAdvice,
  aiBusy,
  aiError,
  onClose,
}: {
  month: string
  txs: Transaction[]
  currency: string
  locale: string
  provisions: ProvisionStatus[]
  /** Trips and parties, so a tagged line can say which one it belongs to. */
  events: SpecialEvent[]
  /**
   * A line just tagged to an event that a hand-logged spend nearly — but not
   * exactly — answers to. Asked rather than resolved: the disagreement is the
   * interesting part.
   */
  eventQuestion?: { tx: Transaction; event: SpecialEvent; logged: EventExpense } | null
  onAnswerEventQuestion?: (same: boolean) => void
  /** Card accounts, so a card payment can say which one it settles. */
  cards: Account[]
  onSetCategory: (id: string, category: string) => void
  onSetCard: (id: string, cardAccountId: string | undefined) => void
  onToggle: (id: string, reconciled: boolean) => void
  onConfirmAll: () => void
  onAiCategorize?: () => void
  /** Opens the allocation pop-up for one transaction — owned by the parent so it stacks above this overlay. */
  onProvision: (t: Transaction) => void
  /** Streams Claude's take on one line — omitted when there's no API key. */
  onAskAdvice?: (t: Transaction, handlers: StreamHandlers) => void
  /** This month's surplus, offered once everything is reconciled. */
  aiBusy?: boolean
  aiError?: string
  onClose: () => void
}) {
  // Advice is asked for one line at a time and streams in place; opening a
  // different line replaces it, so the card never carries a stale answer.
  const eventLabels = useMemo(
    () => Object.fromEntries(events.map((e) => [e.id, e.label])),
    [events],
  )
  const [adviceFor, setAdviceFor] = useState<string | null>(null)
  const [advice, setAdvice] = useState('')
  const [adviceError, setAdviceError] = useState('')

  function askAdvice(t: Transaction) {
    if (!onAskAdvice) return
    if (adviceFor === t.id) {
      setAdviceFor(null)
      return
    }
    setAdviceFor(t.id)
    setAdvice('')
    setAdviceError('')
    onAskAdvice(t, {
      onText: (delta) => setAdvice((prev) => prev + delta),
      onDone: () => {},
      onError: (message) => setAdviceError(message),
    })
  }

  const [typeFilter, setTypeFilter] = useState('')
  const [sortBy, setSortBy] = useState<'default' | 'date' | 'name' | 'amount'>('default')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function changeSort(field: typeof sortBy) {
    setSortBy(field)
    setSortDir(field === 'amount' ? 'desc' : 'asc')
  }

  const availableTypes = useMemo(
    () => Array.from(new Set(txs.map((t) => t.category))).sort((a, b) => a.localeCompare(b)),
    [txs],
  )

  const filtered = useMemo(
    () => (typeFilter ? txs.filter((t) => t.category === typeFilter) : txs),
    [txs, typeFilter],
  )

  // Default: needs-attention first (unreconciled, Other on top), then by date.
  // An explicit sort just orders the filtered list by that field, direction toggle-able.
  const ordered = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const list = filtered.slice()
    if (sortBy === 'date') list.sort((a, b) => dir * a.date.localeCompare(b.date))
    else if (sortBy === 'name') list.sort((a, b) => dir * a.description.localeCompare(b.description))
    else if (sortBy === 'amount') list.sort((a, b) => dir * (Math.abs(a.amount) - Math.abs(b.amount)))
    else {
      const rank = (t: Transaction) => (t.reconciled ? 2 : t.category === 'Other' ? 0 : 1)
      list.sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date))
    }
    return list
  }, [filtered, sortBy, sortDir])

  const done = txs.filter((t) => t.reconciled).length
  const total = txs.length
  /**
   * A payment aimed at no card settles none — silently, since nothing else
   * marks it wrong. With one card there's nothing to aim, so it always
   * resolves; with several, it needs a pick.
   */
  const unaimed = (t: Transaction) =>
    t.category === CARD_PAYMENT_CATEGORY && cards.length > 1 && !t.cardAccountId

  /**
   * A spend whose category matches a provision that has money in it, never
   * linked to any pot. Categorising a bill as "Taxes" doesn't by itself draw
   * from the tax pot — savings can pay for anything, so the link has to be
   * made on purpose — but a match this exact is worth naming out loud rather
   * than leaving the reader to remember the pot exists.
   */
  const unlinkedMatch = (t: Transaction) =>
    t.amount < 0 &&
    transactionAllocations(t).length === 0 &&
    provisions.find((p) => p.category === t.category && p.funded > 0.5)
  const suggestable = txs.filter((t) => !t.reconciled && t.category !== 'Other' && !unaimed(t)).length
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
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select
                className="input py-1 w-auto text-xs"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by type"
              >
                <option value="">All types</option>
                {availableTypes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                className="input py-1 w-auto text-xs"
                value={sortBy}
                onChange={(e) => changeSort(e.target.value as typeof sortBy)}
                aria-label="Sort by"
              >
                <option value="default">Needs attention</option>
                <option value="date">Sort: Date</option>
                <option value="name">Sort: Name</option>
                <option value="amount">Sort: Amount</option>
              </select>
              {sortBy !== 'default' && (
                <button
                  className="btn-subtle p-1.5 text-xs"
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                  aria-label="Toggle sort direction"
                >
                  {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              )}
            </div>
          </div>

          <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-2.5">
            {ordered.length === 0 && txs.length === 0 && (
              <p className="text-center text-muted py-10">No transactions for this month.</p>
            )}
            {ordered.length === 0 && txs.length > 0 && (
              <p className="text-center text-muted py-10">No transactions match this filter.</p>
            )}
            {ordered.map((t) => {
              const isOther = t.category === 'Other'
              const needsCard = unaimed(t)
              const blocked = isOther || needsCard
              return (
                <div
                  key={t.id}
                  className={classNames(
                    'rounded-xl border p-3.5 transition',
                    t.reconciled ? 'border-line bg-forest-tint/20 opacity-70' : 'border-line',
                    blocked && !t.reconciled && 'border-gold/50',
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
                        disabled={blocked}
                        title={
                          isOther
                            ? 'Pick a category first'
                            : needsCard
                              ? 'Say which card this pays off first — otherwise it settles neither'
                              : 'Confirm'
                        }
                      >
                        <IconCheck width={15} height={15} /> OK
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <CardPicker tx={t} cards={cards} onPick={(c) => onSetCard(t.id, c)} />
                    <ProvisionButton
                      tx={t}
                      provisions={provisions}
                      currency={currency}
                      locale={locale}
                      onOpen={() => onProvision(t)}
                      eventLabel={eventLabels[t.eventId ?? '']}
                    />
                    {(() => {
                      const match = unlinkedMatch(t)
                      return (
                        match && (
                          <button
                            className="pill bg-gold/15 text-gold hover:bg-gold/25 inline-flex items-center gap-1"
                            onClick={() => onProvision(t)}
                          >
                            Pull from {match.label}?
                          </button>
                        )
                      )
                    })()}
                    {/* Only while a line is still open: once it's reconciled
                        the decision is made and the question is moot. */}
                    {onAskAdvice && !t.reconciled && (
                      <button
                        className={classNames(
                          'btn-subtle text-xs shrink-0 inline-flex items-center gap-1.5',
                          adviceFor === t.id && 'text-forest',
                        )}
                        onClick={() => askAdvice(t)}
                        title="Ask Claude how to treat this line, using your full picture"
                      >
                        <IconHelp width={14} height={14} />
                        {adviceFor === t.id ? 'Hide' : 'What do I do?'}
                      </button>
                    )}
                  </div>
                  {/* The disagreement, asked where it happened. Your own tally
                      said one thing and the statement says another; which is
                      right is a judgement only you can make. */}
                  {eventQuestion?.tx.id === t.id && (
                    <div className="mt-2 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2.5 text-sm">
                      <div className="text-ink/80">
                        During <span className="font-medium">{eventQuestion.event.label}</span> you logged{' '}
                        <span className="font-medium">{eventQuestion.logged.label}</span> at{' '}
                        {formatMoney(eventQuestion.logged.amount, currency, locale)} on{' '}
                        {eventQuestion.logged.date.slice(5)}. Is this that spend?
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button
                          className="btn-primary text-xs"
                          onClick={() => onAnswerEventQuestion?.(true)}
                        >
                          Yes — it was {formatMoney(Math.abs(t.amount), currency, locale)}
                        </button>
                        <button
                          className="btn-subtle text-xs"
                          onClick={() => onAnswerEventQuestion?.(false)}
                        >
                          No, separate spends
                        </button>
                      </div>
                    </div>
                  )}
                  {adviceFor === t.id && (
                    <div className="mt-2 rounded-lg border border-forest/25 bg-forest-tint/30 p-3">
                      {adviceError ? (
                        <p className="text-xs text-clay">{adviceError}</p>
                      ) : advice ? (
                        <div className="text-sm [&_p]:mb-1.5 [&_ul]:mb-0 [&_li]:mb-0.5">
                          <Markdown text={advice} />
                        </div>
                      ) : (
                        <p className="text-xs text-muted">Reading your numbers…</p>
                      )}
                    </div>
                  )}
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
