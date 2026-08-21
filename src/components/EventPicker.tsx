import { NON_CASHFLOW, SAVINGS_CATEGORY, INVESTMENTS_CATEGORY } from '../lib/categorize'
import type { SpecialEvent, Transaction } from '../lib/types'

/**
 * Which event a spend belongs to, asked where the spend is actually seen.
 *
 * Events are offered whatever their dates: a deposit paid two months early is
 * as much part of the trip as the hotel bill during it. The ones whose dates
 * contain the transaction come first, since that is the ordinary case and the
 * list is otherwise in no order the reader can predict.
 */
export function EventPicker({
  tx,
  events,
  onPick,
  compact,
}: {
  tx: Transaction
  events: SpecialEvent[]
  onPick: (eventId: string | undefined) => void
  compact?: boolean
}) {
  // Money in is not event spending; a transfer between your own accounts is not
  // spending at all; and money moved into a pot is kept rather than spent, so
  // none of the three can belong to a trip.
  const kept = tx.category === SAVINGS_CATEGORY || tx.category === INVESTMENTS_CATEGORY
  if (!events.length || tx.amount >= 0 || NON_CASHFLOW.has(tx.category) || kept) return null

  const during = (e: SpecialEvent) => tx.date >= e.startDate && tx.date <= e.endDate
  const ordered = [...events].sort(
    (a, b) => Number(during(b)) - Number(during(a)) || a.startDate.localeCompare(b.startDate),
  )
  const tagged = !!tx.eventId && events.some((e) => e.id === tx.eventId)

  return (
    <label className="inline-flex items-center gap-1.5 shrink-0 min-w-0">
      <span className={compact ? 'sr-only' : 'text-xs text-muted'}>Event</span>
      <select
        className={
          'input py-1 text-xs w-auto max-w-[9rem] ' + (tagged ? 'text-forest border-forest/40' : 'text-muted')
        }
        value={tagged ? tx.eventId : ''}
        onChange={(e) => onPick(e.target.value || undefined)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Which event this spend belongs to"
        title={tagged ? 'Counted against this event’s budget' : 'Tag this to a trip or party'}
      >
        <option value="">No event</option>
        {ordered.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
            {during(e) ? '' : ' (other dates)'}
          </option>
        ))}
      </select>
    </label>
  )
}
