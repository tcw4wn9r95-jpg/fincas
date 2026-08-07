import { useState } from 'react'
import { CATEGORIES, suggestKeyword } from '../lib/categorize'
import { formatMoney, classNames } from '../lib/format'
import type { Transaction } from '../lib/types'
import { IconClose, IconTag } from './icons'
import { Portal } from './Portal'

const choices = CATEGORIES.filter((c) => c !== 'Other')

/**
 * A roomy, one-at-a-time sorter for the "Other" pile. Every transaction is shown
 * in full — no truncation — with its whole description, so you can decide where
 * it goes. "Learn this" also remembers the choice, so the same line files itself
 * next month.
 */
export function CategorizeOverlay({
  rows,
  currency,
  locale,
  onSet,
  onLearn,
  onClose,
}: {
  rows: Transaction[]
  currency: string
  locale: string
  onSet: (id: string, category: string) => void
  onLearn: (t: Transaction, category: string) => void
  onClose: () => void
}) {
  const others = rows.filter((r) => r.category === 'Other')

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
        <div className="bg-paper w-full sm:max-w-lg sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[94vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-line">
            <div>
              <h2 className="text-xl">Categorize</h2>
              <p className="text-sm text-muted">
                {others.length > 0
                  ? `${others.length} transaction${others.length === 1 ? '' : 's'} to sort`
                  : 'Everything is sorted'}
              </p>
            </div>
            <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-3">
            {others.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-12 h-12 rounded-full bg-forest-tint text-forest grid place-items-center mx-auto mb-3">
                  ✓
                </div>
                <p className="text-muted">Nothing left in “Other”. Nicely done.</p>
              </div>
            ) : (
              others.map((t) => (
                <CategorizeCard
                  key={t.id}
                  t={t}
                  currency={currency}
                  locale={locale}
                  onSet={onSet}
                  onLearn={onLearn}
                />
              ))
            )}
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

function CategorizeCard({
  t,
  currency,
  locale,
  onSet,
  onLearn,
}: {
  t: Transaction
  currency: string
  locale: string
  onSet: (id: string, category: string) => void
  onLearn: (t: Transaction, category: string) => void
}) {
  const [chosen, setChosen] = useState('')
  const dateLabel = new Date(t.date + 'T00:00:00').toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="text-xs text-muted">{dateLabel}</span>
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

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input py-1.5 flex-1 min-w-[10rem]"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">Choose a category…</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          className="btn-primary inline-flex items-center gap-1.5 shrink-0"
          disabled={!chosen}
          onClick={() => onLearn(t, chosen)}
        >
          <IconTag width={14} height={14} /> Learn this
        </button>
        <button
          className="btn-ghost shrink-0"
          disabled={!chosen}
          onClick={() => onSet(t.id, chosen)}
        >
          Just once
        </button>
      </div>
      {chosen && (
        <p className="text-xs text-muted mt-2">
          <span className="text-forest">Learn this</span> files future lines containing “
          {suggestKeyword(t.description)}” as {chosen}. <span className="text-forest">Just once</span>{' '}
          changes only this one.
        </p>
      )}
    </div>
  )
}
