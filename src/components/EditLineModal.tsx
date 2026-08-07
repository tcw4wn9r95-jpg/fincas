import { useMemo, useState } from 'react'
import { CATEGORIES } from '../lib/categorize'
import { itemAmountForMonth } from '../lib/forecast'
import { formatMoney, formatMonthLabel, parseAmount } from '../lib/format'
import type { RecurringItem } from '../lib/types'
import { IconClose, IconTrash } from './icons'
import { Portal } from './Portal'

const expenseCats = CATEGORIES.filter((c) => c !== 'Income')

type Mode = 'set' | 'scale'

interface Props {
  item: RecurringItem
  months: string[] // the planner's visible months (current → end of plan)
  currency: string
  locale: string
  onClose: () => void
  onField: (fields: Partial<RecurringItem>) => void
  onBulk: (mode: Mode, value: number, from?: string, to?: string) => void
  onRemove: () => void
}

/**
 * Edit a plan line — rename/recategorise, and (the missing piece) push one
 * amount change across many months at once, instead of cell by cell. The bulk
 * edit writes precise per-month values just like typing into the grid, so the
 * forecast picks it up immediately.
 */
export function EditLineModal({
  item,
  months,
  currency,
  locale,
  onClose,
  onField,
  onBulk,
  onRemove,
}: Props) {
  const [label, setLabel] = useState(item.label)
  const [category, setCategory] = useState(item.category)
  const [mode, setMode] = useState<Mode>('set')
  const [value, setValue] = useState('')
  const [from, setFrom] = useState(months[0] ?? '')
  const [to, setTo] = useState('')

  const scoped = useMemo(
    () => months.filter((m) => (!from || m >= from) && (!to || m <= to)),
    [months, from, to],
  )
  const currentInScope = useMemo(
    () => scoped.reduce((s, m) => s + itemAmountForMonth(item, m), 0),
    [scoped, item],
  )
  const num = parseAmount(value)
  const hasValue = value.trim() !== '' && !Number.isNaN(num)
  const projected = hasValue
    ? mode === 'set'
      ? Math.abs(num) * scoped.length
      : Math.round(currentInScope * (Math.abs(num) / 100) * 100) / 100
    : currentInScope

  function save() {
    const fields: Partial<RecurringItem> = {}
    if (label.trim() && label.trim() !== item.label) fields.label = label.trim()
    if (category !== item.category) fields.category = category
    if (Object.keys(fields).length) onField(fields)
    if (hasValue) onBulk(mode, Math.abs(num), from || undefined, to || undefined)
    onClose()
  }

  const fx = (n: number) => formatMoney(n, currency, locale)
  const scopeLabel =
    scoped.length === 0
      ? 'no months'
      : `${formatMonthLabel(scoped[0] + '-01', locale)}${
          scoped.length > 1 ? `–${formatMonthLabel(scoped[scoped.length - 1] + '-01', locale)}` : ''
        } · ${scoped.length} ${scoped.length === 1 ? 'month' : 'months'}`

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
      <div className="bg-paper w-full sm:max-w-md sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-xl">Edit line</h2>
          <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label">Name</label>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="label">Type</label>
              {item.flow === 'income' ? (
                <input className="input" value="Income" disabled />
              ) : (
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {expenseCats.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-line p-4 space-y-3 bg-canvas/50">
            <div className="label">Change amount across months</div>
            <div className="grid grid-cols-2 gap-2 p-1 bg-canvas rounded-xl border border-line">
              {(['set', 'scale'] as Mode[]).map((mo) => (
                <button
                  key={mo}
                  onClick={() => setMode(mo)}
                  className={
                    mode === mo
                      ? 'rounded-lg py-2 text-sm font-medium bg-forest text-paper'
                      : 'rounded-lg py-2 text-sm font-medium text-muted hover:text-ink'
                  }
                >
                  {mo === 'set' ? 'Set to' : 'Change by %'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-sm text-muted">
              {mode === 'set' ? 'New monthly amount' : 'Adjust each month to'}
              <input
                className="input py-1.5 w-28 tabular-nums"
                type="text"
                inputMode="decimal"
                placeholder={mode === 'set' ? '0.00' : '105'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              {mode === 'scale' && '% of plan'}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">From</label>
                <input
                  className="input py-1.5"
                  type="month"
                  value={from}
                  min={months[0]}
                  max={months[months.length - 1]}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Until (optional)</label>
                <input
                  className="input py-1.5"
                  type="month"
                  value={to}
                  min={from || months[0]}
                  max={months[months.length - 1]}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>

            <p className="text-xs text-muted">
              Applies to {scopeLabel}.
              {hasValue && scoped.length > 0 && (
                <>
                  {' '}
                  Total for this line over that span:{' '}
                  <span className="text-ink tabular-nums">{fx(currentInScope)}</span> →{' '}
                  <span className="text-forest tabular-nums">{fx(projected)}</span>.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-line">
          <button
            className="btn-subtle text-clay inline-flex items-center gap-1.5"
            onClick={() => {
              onRemove()
              onClose()
            }}
          >
            <IconTrash width={15} height={15} /> Delete
          </button>
          <div className="flex items-center gap-3">
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  )
}
