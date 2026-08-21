import { useMemo, useState } from 'react'
import { useData } from '../store'
import { CATEGORIES } from '../lib/categorize'
import {
  allEventStatuses,
  eventCandidates,
  eventStatus,
  eventTransactions,
  pendingExpenses,
  tagTransactionToEvent,
  type EventStatus,
} from '../lib/events'
import { formatMoney, classNames, parseAmount, todayISO, uid } from '../lib/format'
import type { EventKind, SpecialEvent, Transaction } from '../lib/types'
import { IconPlus, IconTrash, IconCheck, IconEvent, IconClose } from './icons'

const KIND_LABEL: Record<EventKind, string> = {
  travel: 'Trip',
  party: 'Party',
  other: 'Event',
}

const PHASE_PILL: Record<EventStatus['phase'], string> = {
  live: 'bg-forest text-paper',
  upcoming: 'bg-forest-tint text-forest',
  past: 'bg-line/60 text-muted',
}

function shortRange(startDate: string, endDate: string, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const start = new Date(startDate + 'T00:00:00').toLocaleDateString(locale, opts)
  if (endDate === startDate) return start
  const end = new Date(endDate + 'T00:00:00').toLocaleDateString(locale, opts)
  return `${start} – ${end}`
}

function phaseText(e: EventStatus): string {
  if (e.phase === 'live') return 'Happening now'
  if (e.phase === 'upcoming')
    return e.daysToStart === 0 ? 'Starts today' : `In ${e.daysToStart} day${e.daysToStart === 1 ? '' : 's'}`
  return 'Finished'
}

/** Budget bar: what's confirmed, what's only logged by hand, what's left. */
function BudgetBar({ e }: { e: EventStatus }) {
  const scale = Math.max(e.budget, e.spent, 1)
  return (
    <div className="h-2 rounded-full bg-line overflow-hidden flex">
      <div
        className={classNames('h-full', e.over ? 'bg-clay' : 'bg-forest')}
        style={{ width: `${(e.confirmed / scale) * 100}%` }}
        title="Confirmed by a statement"
      />
      <div
        className={classNames('h-full', e.over ? 'bg-clay/50' : 'bg-sage')}
        style={{ width: `${(e.pending / scale) * 100}%` }}
        title="Logged by hand, not yet in a statement"
      />
    </div>
  )
}

export function Events() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, opts)
  const today = todayISO()

  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const statuses = useMemo(() => allEventStatuses(data, today), [data, today])
  const open = data.events?.find((e) => e.id === openId) ?? null

  function addEvent(draft: {
    label: string
    kind: EventKind
    startDate: string
    endDate: string
    budget: number
    category: string
    provision: boolean
  }) {
    const id = uid()
    const provisionId = draft.provision ? uid() : undefined
    const event: SpecialEvent = {
      id,
      label: draft.label,
      kind: draft.kind,
      startDate: draft.startDate,
      endDate: draft.endDate,
      budget: draft.budget,
      category: draft.category,
      provisionId,
      expenses: [],
      createdAt: today,
    }
    update((d) => {
      d.events = [...(d.events ?? []), event]
      // The sinking fund is an ordinary provision — it shows up in the plan and
      // takes allocations through the same pop-up as every other pot.
      if (provisionId) {
        d.provisions.push({
          id: provisionId,
          label: draft.label,
          category: draft.category,
          targetAmount: draft.budget,
          dueDate: draft.startDate,
          createdAt: today,
        })
      }
      return d
    })
    setCreating(false)
    setOpenId(id)
  }

  function editEvent(id: string, fields: Partial<SpecialEvent>) {
    update((d) => {
      const e = d.events?.find((x) => x.id === id)
      if (!e) return d
      Object.assign(e, fields)
      // Keep the fund's headline figures in step with the event they're for.
      const p = e.provisionId ? d.provisions.find((x) => x.id === e.provisionId) : undefined
      if (p) {
        if (fields.label) p.label = fields.label
        if (fields.budget !== undefined) p.targetAmount = fields.budget
        if (fields.startDate) p.dueDate = fields.startDate
        if (fields.category) p.category = fields.category
      }
      return d
    })
  }

  function removeEvent(id: string) {
    const e = data.events?.find((x) => x.id === id)
    if (!e) return
    const hasFund = !!e.provisionId && data.provisions.some((p) => p.id === e.provisionId)
    if (
      !confirm(
        `Delete "${e.label}"? Its logged expenses go with it and any tagged transactions are released back to the month.` +
          (hasFund ? '\n\nThe money you set aside stays as a provision in your plan.' : ''),
      )
    )
      return
    update((d) => {
      d.events = (d.events ?? []).filter((x) => x.id !== id)
      for (const t of d.transactions) if (t.eventId === id) t.eventId = undefined
      for (const t of d.sampleTransactions ?? []) if (t.eventId === id) t.eventId = undefined
      return d
    })
    setOpenId(null)
  }

  /** Log a spend on the spot — no statement needed, and it never hits the month's totals. */
  function logExpense(id: string, expense: { date: string; label: string; amount: number; category: string }) {
    update((d) => {
      const e = d.events?.find((x) => x.id === id)
      if (!e) return d
      e.expenses.push({ id: uid(), ...expense })
      return d
    })
  }

  function removeExpense(eventId: string, expenseId: string) {
    update((d) => {
      const e = d.events?.find((x) => x.id === eventId)
      if (!e) return d
      e.expenses = e.expenses.filter((x) => x.id !== expenseId)
      return d
    })
  }

  /**
   * Claim a real transaction for the event. If a logged line was already
   * standing in for the same amount, that line retires instead of double-counting.
   */
  function tagTransaction(eventId: string, txId: string, tagged: boolean) {
    update((d) => {
      tagTransactionToEvent(d, tagged ? eventId : undefined, txId)
      return d
    })
  }

  if (open) {
    return (
      <EventDetail
        event={open}
        status={eventStatus(data, open, today)}
        currency={currency}
        locale={locale}
        onBack={() => setOpenId(null)}
        onEdit={(fields) => editEvent(open.id, fields)}
        onRemove={() => removeEvent(open.id)}
        onLog={(x) => logExpense(open.id, x)}
        onRemoveExpense={(x) => removeExpense(open.id, x)}
        onTag={(txId, tagged) => tagTransaction(open.id, txId, tagged)}
        candidates={eventCandidates(data, open)}
        tagged={eventTransactions(data, open.id)}
      />
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl">Events</h2>
          <p className="text-muted">
            Trips, parties and the like — budgeted ahead, tracked as they happen
          </p>
        </div>
        {!creating && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <IconPlus width={16} height={16} /> New event
          </button>
        )}
      </div>

      {creating && (
        <NewEventForm
          currency={currency}
          locale={locale}
          onCancel={() => setCreating(false)}
          onCreate={addEvent}
        />
      )}

      {statuses.length === 0 && !creating && (
        <div className="card p-8 text-center">
          <IconEvent width={28} height={28} className="mx-auto text-muted mb-3" />
          <p className="text-muted max-w-md mx-auto">
            Plan a trip or a party, set money aside for it, then log what you spend as it happens.
            When the statement lands you'll see how it really went.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {statuses.map((e) => (
          <button
            key={e.id}
            className="card p-5 text-left hover:shadow-lift transition"
            onClick={() => setOpenId(e.id)}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="min-w-0">
                <div className="font-medium truncate">{e.label}</div>
                <div className="text-xs text-muted">
                  {KIND_LABEL[e.kind]} · {shortRange(e.startDate, e.endDate, locale)}
                </div>
              </div>
              <span className={classNames('pill shrink-0', PHASE_PILL[e.phase])}>{phaseText(e)}</span>
            </div>
            <div className="flex items-end justify-between gap-3 mt-3 mb-2">
              <div className="tabular-nums">
                <span className={classNames('text-xl', e.over && 'text-clay')}>{fx(e.spent)}</span>
                <span className="text-muted text-sm"> of {fx(e.budget)}</span>
              </div>
              <div
                className={classNames('text-sm tabular-nums', e.over ? 'text-clay' : 'text-muted')}
              >
                {e.over ? `${fx(-e.remaining)} over` : `${fx(e.remaining)} left`}
              </div>
            </div>
            <BudgetBar e={e} />
            <div className="flex items-center gap-3 text-xs text-muted mt-2">
              {e.hasProvision && <span>{fx(e.setAside)} set aside</span>}
              {e.pendingCount > 0 && (
                <span className="text-sage">{e.pendingCount} logged, not yet confirmed</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function NewEventForm({
  currency,
  locale,
  onCancel,
  onCreate,
}: {
  currency: string
  locale: string
  onCancel: () => void
  onCreate: (draft: {
    label: string
    kind: EventKind
    startDate: string
    endDate: string
    budget: number
    category: string
    provision: boolean
  }) => void
}) {
  const today = todayISO()
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<EventKind>('travel')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState('')
  const [budget, setBudget] = useState('')
  const [category, setCategory] = useState('Travel')
  const [provision, setProvision] = useState(true)

  const amount = parseAmount(budget) || 0
  const ready = label.trim().length > 0 && amount > 0 && !!startDate

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg">New event</h3>
        <button className="btn-subtle p-2" onClick={onCancel} aria-label="Cancel">
          <IconClose />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="event-label">
            What is it
          </label>
          <input
            id="event-label"
            className="input"
            placeholder="Trip to Japan"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label">Kind</label>
          <div className="grid grid-cols-3 gap-1 p-1 bg-canvas rounded-xl border border-line">
            {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k)
                  setCategory(k === 'travel' ? 'Travel' : k === 'party' ? 'Dining' : category)
                }}
                className={classNames(
                  'rounded-lg py-1.5 text-sm font-medium transition-colors',
                  kind === k ? 'bg-forest text-paper' : 'text-muted hover:text-ink',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-1">
          <label className="label" htmlFor="event-start">
            Starts
          </label>
          <input
            id="event-start"
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="col-span-1">
          <label className="label" htmlFor="event-end">
            Ends
          </label>
          <input
            id="event-end"
            className="input"
            type="date"
            value={endDate}
            min={startDate}
            placeholder={startDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="col-span-1">
          <label className="label" htmlFor="event-budget">
            Budget
          </label>
          <input
            id="event-budget"
            className="input tabular-nums"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <div className="col-span-1">
          <label className="label" htmlFor="event-category">
            Spending goes under
          </label>
          <select
            id="event-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.filter((c) => c !== 'Income' && c !== 'Internal').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-line p-3.5 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={provision}
          onChange={(e) => setProvision(e.target.checked)}
        />
        <span className="text-sm">
          <span className="font-medium">Set money aside for it</span>
          <span className="block text-muted text-xs mt-0.5">
            Creates a provision due{' '}
            {startDate
              ? new Date(startDate + 'T00:00:00').toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })
              : 'on the start date'}{' '}
            targeting {amount > 0 ? formatMoney(amount, currency, locale) : 'the budget'}, so you can
            allocate toward it when you reconcile.
          </span>
        </span>
      </label>

      <div className="flex items-center justify-end gap-3">
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!ready}
          onClick={() =>
            onCreate({
              label: label.trim(),
              kind,
              startDate,
              endDate: endDate || startDate,
              budget: amount,
              category,
              provision,
            })
          }
        >
          Create event
        </button>
      </div>
    </div>
  )
}

function EventDetail({
  event,
  status,
  currency,
  locale,
  onBack,
  onEdit,
  onRemove,
  onLog,
  onRemoveExpense,
  onTag,
  candidates,
  tagged,
}: {
  event: SpecialEvent
  status: EventStatus
  currency: string
  locale: string
  onBack: () => void
  onEdit: (fields: Partial<SpecialEvent>) => void
  onRemove: () => void
  onLog: (x: { date: string; label: string; amount: number; category: string }) => void
  onRemoveExpense: (id: string) => void
  onTag: (txId: string, tagged: boolean) => void
  candidates: { tx: Transaction; source: 'month' | 'week' }[]
  tagged: { tx: Transaction; source: 'month' | 'week' }[]
}) {
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, opts)
  const today = todayISO()

  // Quick add — the thing you actually use standing at the bar.
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState(event.category)
  const [date, setDate] = useState(
    today >= event.startDate && today <= event.endDate ? today : event.startDate,
  )
  const value = parseAmount(amount) || 0

  function submit() {
    if (value <= 0) return
    onLog({ date, label: label.trim() || 'Expense', amount: Math.abs(value), category })
    setAmount('')
    setLabel('')
  }

  const pending = pendingExpenses(event)
  const matched = event.expenses.filter((x) => x.matchedTxId)

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <button className="btn-subtle text-xs mb-1 -ml-2" onClick={onBack}>
            ← All events
          </button>
          <h2 className="text-2xl">{event.label}</h2>
          <p className="text-muted">
            {KIND_LABEL[event.kind]} · {shortRange(event.startDate, event.endDate, locale)} ·{' '}
            {phaseText(status)}
          </p>
        </div>
        <button className="btn-subtle text-clay" onClick={onRemove}>
          <IconTrash width={15} height={15} /> Delete
        </button>
      </div>

      {/* Where the budget stands */}
      <div className="card p-6">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-3">
          <div>
            <div className="label">Spent</div>
            <div className={classNames('stat-value tabular-nums', status.over && 'text-clay')}>
              {fx(status.spent)}
            </div>
          </div>
          <div className="text-right">
            <div className="label">{status.over ? 'Over budget' : 'Left to spend'}</div>
            <div
              className={classNames(
                'stat-value tabular-nums',
                status.over ? 'text-clay' : 'text-forest',
              )}
            >
              {fx(Math.abs(status.remaining))}
            </div>
          </div>
        </div>
        <BudgetBar e={status} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted mt-2">
          <span className="tabular-nums">
            Budget <span className="text-ink">{fx(status.budget)}</span>
          </span>
          <span className="tabular-nums">
            Confirmed <span className="text-ink">{fx(status.confirmed)}</span>
          </span>
          {status.pending > 0.005 && (
            <span className="tabular-nums text-sage">Logged by hand {fx(status.pending)}</span>
          )}
          {status.hasProvision && (
            <span className="tabular-nums">
              Set aside <span className="text-ink">{fx(status.setAside)}</span>
            </span>
          )}
        </div>
        {status.hasProvision && status.setAside < 0.005 && (
          <p className="text-xs text-muted mt-2">
            Nothing set aside yet — its provision is waiting in your plan, so allocate to it next
            time you reconcile a transfer.
          </p>
        )}
        {status.hasProvision && status.setAside >= 0.005 && status.setAside < status.spent && (
          <p className="text-xs text-muted mt-2">
            {fx(status.spent - status.setAside)} of this came from the month rather than the money
            you set aside.
          </p>
        )}
      </div>

      {/* Log a spend on the spot */}
      <div className="card p-6">
        <h3 className="text-lg">Add an expense</h3>
        <p className="text-sm text-muted mb-4">
          Log it now, while you're here. It counts against the budget straight away and stays out of
          your month until the real transaction shows up.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input w-28 tabular-nums text-right"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-label="Amount"
          />
          <input
            className="input flex-1 min-w-[140px]"
            placeholder="What was it?"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-label="What was it"
          />
          <select
            className="input w-auto"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
          >
            {CATEGORIES.filter((c) => c !== 'Income' && c !== 'Internal').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="input w-auto"
            type="date"
            value={date}
            min={event.startDate}
            max={event.endDate}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
          />
          <button className="btn-primary" onClick={submit} disabled={value <= 0}>
            <IconPlus width={16} height={16} /> Add
          </button>
        </div>

        {pending.length > 0 && (
          <div className="mt-4 divide-y divide-line/60">
            {pending.map((x) => (
              <div key={x.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="text-muted w-12 shrink-0 tabular-nums">{x.date.slice(5)}</span>
                <span className="flex-1 min-w-0 truncate">{x.label}</span>
                <span className="pill bg-line/50 text-muted shrink-0">{x.category}</span>
                <span className="tabular-nums w-20 text-right shrink-0">{fx(x.amount)}</span>
                <button
                  className="text-muted hover:text-clay shrink-0"
                  onClick={() => onRemoveExpense(x.id)}
                  aria-label={`Remove ${x.label}`}
                >
                  <IconTrash width={15} height={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What the statements say */}
      <div className="card p-6">
        <h3 className="text-lg">From your statements</h3>
        <p className="text-sm text-muted mb-4">
          Transactions you've tagged to this event — from a monthly import or a weekly export. These
          are the real numbers; anything you logged by hand for the same amount steps aside
          automatically.
        </p>
        {tagged.length === 0 && (
          <p className="text-sm text-muted">
            Nothing tagged yet. Import the month (or your weekly export) and the spending inside
            these dates will show up below to confirm.
          </p>
        )}
        <div className="divide-y divide-line/60">
          {tagged.map(({ tx, source }) => (
            <div key={tx.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="text-muted w-12 shrink-0 tabular-nums">{tx.date.slice(5)}</span>
              <span className="flex-1 min-w-0 truncate" title={tx.description}>
                {tx.description}
              </span>
              {source === 'week' && <span className="pill bg-line/50 text-muted shrink-0">weekly</span>}
              <span className="pill bg-line/50 text-muted shrink-0">{tx.category}</span>
              <span className="tabular-nums w-20 text-right shrink-0">{fx(Math.abs(tx.amount))}</span>
              <button
                className="btn-subtle text-xs shrink-0"
                onClick={() => onTag(tx.id, false)}
                title="Release this back to the month"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {matched.length > 0 && (
          <p className="text-xs text-muted mt-3">
            {matched.length} line{matched.length === 1 ? '' : 's'} you logged by hand{' '}
            {matched.length === 1 ? 'has' : 'have'} been confirmed by a statement and no longer count
            twice.
          </p>
        )}
      </div>

      {/* Month-end / weekly reconciliation */}
      {candidates.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg">Spending in these dates</h3>
          <p className="text-sm text-muted mb-4">
            Found in your imports but not tagged to the event. Add what belongs — rent landing
            mid-trip doesn't.
          </p>
          <div className="divide-y divide-line/60">
            {candidates.map(({ tx, source }) => (
              <div key={tx.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="text-muted w-12 shrink-0 tabular-nums">{tx.date.slice(5)}</span>
                <span className="flex-1 min-w-0 truncate" title={tx.description}>
                  {tx.description}
                </span>
                {source === 'week' && (
                  <span className="pill bg-line/50 text-muted shrink-0">weekly</span>
                )}
                <span className="pill bg-line/50 text-muted shrink-0">{tx.category}</span>
                <span className="tabular-nums w-20 text-right shrink-0">
                  {fx(Math.abs(tx.amount))}
                </span>
                <button className="btn-subtle text-xs shrink-0" onClick={() => onTag(tx.id, true)}>
                  <IconCheck width={14} height={14} /> Add to event
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Where it went */}
      {status.byCategory.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg">Where it went</h3>
          <p className="text-sm text-muted mb-4">Across everything counted so far.</p>
          <div className="space-y-2">
            {status.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="pill bg-forest-tint text-forest w-28 shrink-0 justify-center">
                  {c.category}
                </span>
                <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
                  <div
                    className="h-full bg-sage rounded-full"
                    style={{ width: `${(c.amount / Math.max(status.spent, 1)) * 100}%` }}
                  />
                </div>
                <span className="tabular-nums w-20 text-right text-sm">{fx(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Adjust the plan */}
      <div className="card p-6">
        <h3 className="text-lg">Details</h3>
        <p className="text-sm text-muted mb-4">
          Change the budget or the dates — the fund set aside for it follows along.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="detail-budget">
              Budget
            </label>
            <input
              id="detail-budget"
              className="input tabular-nums"
              type="text"
              inputMode="decimal"
              defaultValue={event.budget}
              onBlur={(e) => onEdit({ budget: parseAmount(e.target.value) || event.budget })}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="detail-category">
              Spending goes under
            </label>
            <select
              id="detail-category"
              className="input"
              value={event.category}
              onChange={(e) => onEdit({ category: e.target.value })}
            >
              {CATEGORIES.filter((c) => c !== 'Income' && c !== 'Internal').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-1">
            <label className="label" htmlFor="detail-start">
              Starts
            </label>
            <input
              id="detail-start"
              className="input"
              type="date"
              value={event.startDate}
              onChange={(e) => e.target.value && onEdit({ startDate: e.target.value })}
            />
          </div>
          <div className="col-span-1">
            <label className="label" htmlFor="detail-end">
              Ends
            </label>
            <input
              id="detail-end"
              className="input"
              type="date"
              value={event.endDate}
              min={event.startDate}
              onChange={(e) => e.target.value && onEdit({ endDate: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
