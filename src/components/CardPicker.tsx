import { CARD_PAYMENT_CATEGORY } from '../lib/categorize'
import type { Account, Transaction } from '../lib/types'

/**
 * Which card a payment settles.
 *
 * Only shown when the answer isn't already obvious: a line filed as a card
 * payment, with more than one card to aim it at. With a single card the
 * transaction stays unmarked and `cardPaymentTarget` resolves it — asking would
 * be ceremony. With two, an unaimed payment settles neither, so this asks
 * outright rather than guessing wrong every month.
 */
export function CardPicker({
  tx,
  cards,
  onPick,
  compact,
}: {
  tx: Transaction
  cards: Account[]
  onPick: (cardAccountId: string | undefined) => void
  compact?: boolean
}) {
  if (tx.category !== CARD_PAYMENT_CATEGORY || cards.length < 2) return null
  const unset = !tx.cardAccountId
  return (
    <label className="inline-flex items-center gap-1.5 shrink-0">
      <span className={compact ? 'sr-only' : 'text-xs text-muted'}>Settles</span>
      <select
        className={
          'input py-1 text-xs w-auto ' + (unset ? 'text-clay border-clay/50' : 'text-ink')
        }
        value={tx.cardAccountId ?? ''}
        onChange={(e) => onPick(e.target.value || undefined)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Which card this payment settles"
        title={unset ? 'Say which card this pays off, or it settles neither' : undefined}
      >
        <option value="">Which card?</option>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}
