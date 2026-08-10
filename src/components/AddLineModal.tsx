import { useState } from 'react'
import { CATEGORIES } from '../lib/categorize'
import { uid, currentMonth, addMonths, formatMonthLabel, parseAmount } from '../lib/format'
import type { Cadence, Flow, RecurringItem } from '../lib/types'
import { IconClose } from './icons'
import { Portal } from './Portal'

const expenseCats = CATEGORIES.filter((c) => c !== 'Income')

export const CADENCES: Array<{ value: Cadence; label: string }> = [
  { value: 'monthly', label: 'Every month' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'annual', label: 'Every year' },
  { value: 'one-time', label: 'One time' },
]

interface Props {
  flow: Flow
  locale: string
  onClose: () => void
  onAdd: (item: RecurringItem) => void
}

export function AddLineModal({ flow: initialFlow, locale, onClose, onAdd }: Props) {
  const [flow, setFlow] = useState<Flow>(initialFlow)
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState(initialFlow === 'income' ? 'Income' : 'Housing')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState<Cadence>('monthly')
  const [start, setStart] = useState(currentMonth())
  const [end, setEnd] = useState('')
  const [error, setError] = useState('')

  function switchFlow(f: Flow) {
    setFlow(f)
    setCategory(f === 'income' ? 'Income' : 'Housing')
  }

  function submit() {
    const amt = Math.abs(parseAmount(amount))
    if (!label.trim()) return setError('Give the line a name.')
    if (!amt || Number.isNaN(amt)) return setError('Enter an amount.')
    if (end && end < start) return setError('The end month is before the start month.')

    const item: RecurringItem = {
      id: uid(),
      label: label.trim(),
      amount: amt,
      flow,
      cadence,
      category: flow === 'income' ? 'Income' : category,
      startDate: `${start}-01`,
      // The picker's end month is the last active month, so stop the month after.
      endDate: end ? `${addMonths(end, 1)}-01` : undefined,
      monthly: {},
    }
    onAdd(item)
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
      <div className="bg-paper w-full sm:max-w-md sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-xl">Add a recurring line</h2>
          <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Income / Expense */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-canvas rounded-xl border border-line">
            {(['expense', 'income'] as Flow[]).map((f) => (
              <button
                key={f}
                onClick={() => switchFlow(f)}
                className={
                  flow === f
                    ? 'rounded-lg py-2 text-sm font-medium bg-forest text-paper'
                    : 'rounded-lg py-2 text-sm font-medium text-muted hover:text-ink'
                }
              >
                {f === 'expense' ? 'Expense' : 'Income'}
              </button>
            ))}
          </div>

          <div>
            <label className="label">Name</label>
            <input
              className="input"
              placeholder={flow === 'income' ? 'e.g. Salary' : 'e.g. Gym membership'}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount</label>
              <input
                className="input tabular-nums"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Repeats</label>
              <select
                className="input"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as Cadence)}
              >
                {CADENCES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {flow === 'expense' && (
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {expenseCats.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Starts</label>
              <input
                className="input"
                type="month"
                value={start}
                onChange={(e) => setStart(e.target.value || currentMonth())}
              />
            </div>
            <div>
              <label className="label">Ends (optional)</label>
              <input
                className="input"
                type="month"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted">
            {end
              ? `Applies ${CADENCES.find((c) => c.value === cadence)?.label.toLowerCase()} from ${formatMonthLabel(start + '-01', locale)} through ${formatMonthLabel(end + '-01', locale)}.`
              : `Applies ${CADENCES.find((c) => c.value === cadence)?.label.toLowerCase()} from ${formatMonthLabel(start + '-01', locale)} onward. You can still fine-tune any month in the planner.`}
          </p>

          {error && <div className="text-sm text-clay">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit}>
            Add line
          </button>
        </div>
      </div>
    </div>
    </Portal>
  )
}
