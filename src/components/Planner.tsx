import { useState } from 'react'
import { useData } from '../store'
import { CATEGORIES } from '../lib/categorize'
import { itemAmountForMonth, itemBaseAmountForMonth, planMonths, planSection } from '../lib/forecast'
import { formatMoney, formatMonthLabel, classNames, parseAmount } from '../lib/format'
import type { Cadence, Flow, RecurringItem } from '../lib/types'
import { IconPlus, IconTrash, IconEdit, IconClose, IconMoneyDate } from './icons'
import { AddLineModal, CADENCES } from './AddLineModal'
import { EditLineModal } from './EditLineModal'

// One row per recurring line, grouped into sections (Fixed / Provisions /
// Variable …) with a live subtotal. The default amount + cadence covers the
// common case; overriding a single month is a deliberate, secondary action
// that leaves a visible, removable chip — nothing is hidden in an off-screen
// column the way a full month-by-month grid would hide it.

const expenseCats = CATEGORIES.filter((c) => c !== 'Income')
const SECTION_ORDER = ['Fixed monthly', 'Provisions', 'Variable']
const sectionOf = planSection

const CADENCE_LABEL = new Map(CADENCES.map((c) => [c.value, c.label]))

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function Planner() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const months = planMonths(data)
  const now = months[0]
  const [adding, setAdding] = useState<Flow | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [overrideOpenId, setOverrideOpenId] = useState<string | null>(null)
  const editingItem = data.recurring.find((r) => r.id === editingId) ?? null

  function onAdd(item: RecurringItem) {
    update((d) => {
      d.recurring.push(item)
      return d
    })
    setAdding(null)
  }
  function commitField(id: string, fields: Partial<RecurringItem>) {
    update((d) => {
      const it = d.recurring.find((r) => r.id === id)
      if (it) Object.assign(it, fields)
      return d
    })
  }
  function removeRow(id: string) {
    update((d) => {
      d.recurring = d.recurring.filter((r) => r.id !== id)
      return d
    })
    if (overrideOpenId === id) setOverrideOpenId(null)
  }
  // Push one amount change across a span of months at once — the bulk edit the
  // list alone can't do. Writes precise per-month values so the forecast updates.
  function applyBulk(id: string, mode: 'set' | 'scale', value: number, from?: string, to?: string) {
    update((d) => {
      const it = d.recurring.find((r) => r.id === id)
      if (!it) return d
      const monthly = { ...(it.monthly ?? {}) }
      for (const m of months) {
        if (from && m < from) continue
        if (to && m > to) continue
        if (mode === 'set') monthly[m] = value
        else monthly[m] = round2(itemAmountForMonth(it, m) * (value / 100))
      }
      it.monthly = monthly
      if (mode === 'set') it.amount = value
      return d
    })
  }
  function setOverride(id: string, month: string, value: number) {
    update((d) => {
      const it = d.recurring.find((r) => r.id === id)
      if (it) it.monthly = { ...(it.monthly ?? {}), [month]: value }
      return d
    })
  }
  function clearOverride(id: string, month: string) {
    update((d) => {
      const it = d.recurring.find((r) => r.id === id)
      if (it?.monthly) {
        const next = { ...it.monthly }
        delete next[month]
        it.monthly = next
      }
      return d
    })
  }

  const income = data.recurring.filter((r) => r.flow === 'income')
  const expense = data.recurring.filter((r) => r.flow === 'expense')

  // Group expense lines into sections.
  const groups = new Map<string, RecurringItem[]>()
  for (const it of expense) {
    const sec = sectionOf(it)
    if (!groups.has(sec)) groups.set(sec, [])
    groups.get(sec)!.push(it)
  }
  const ordered = [
    ...SECTION_ORDER.filter((s) => groups.has(s)),
    ...[...groups.keys()].filter((s) => !SECTION_ORDER.includes(s) && s !== 'Variable'),
  ]
  if (groups.has('Variable') && !ordered.includes('Variable')) ordered.push('Variable')

  const sumNow = (items: RecurringItem[]) => items.reduce((s, it) => s + itemAmountForMonth(it, now), 0)
  const incomeNow = sumNow(income)
  const expenseNow = sumNow(expense)
  const netNow = incomeNow - expenseNow
  const fx = (n: number) => formatMoney(n, currency, locale)

  const rowProps = {
    months,
    locale,
    fx,
    overrideOpenId,
    setOverrideOpenId,
    onField: commitField,
    onOverride: setOverride,
    onClearOverride: clearOverride,
    onEdit: setEditingId,
    onRemove: removeRow,
  }

  if (data.recurring.length === 0) {
    return (
      <div className="card p-6">
        <h3 className="text-lg">Monthly planner</h3>
        <p className="text-sm text-muted mb-4">
          One line per recurring cost or income — override a single month only when you need to.
        </p>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => setAdding('income')}>
            <IconPlus width={16} height={16} /> Income line
          </button>
          <button className="btn-ghost" onClick={() => setAdding('expense')}>
            <IconPlus width={16} height={16} /> Expense line
          </button>
        </div>
        {adding && <AddLineModal flow={adding} locale={locale} onClose={() => setAdding(null)} onAdd={onAdd} />}
      </div>
    )
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg">Monthly planner</h3>
          <p className="text-sm text-muted">
            One line per recurring cost or income — override a single month only when you need to.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button className="btn-ghost text-xs" onClick={() => setAdding('income')}>
            <IconPlus width={14} height={14} /> Income
          </button>
          <button className="btn-ghost text-xs" onClick={() => setAdding('expense')}>
            <IconPlus width={14} height={14} /> Expense
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm mt-4 mb-5 pb-4 border-b border-line">
        <span className="text-muted">
          Income <span className="text-ink font-medium tabular-nums">{fx(incomeNow)}</span>/mo
        </span>
        <span className="text-muted">
          Expenses <span className="text-ink font-medium tabular-nums">{fx(expenseNow)}</span>/mo
        </span>
        <span className="text-muted">
          Net{' '}
          <span className={classNames('font-medium tabular-nums', netNow >= 0 ? 'text-forest' : 'text-clay')}>
            {fx(netNow)}
          </span>
          /mo
        </span>
        <span className="text-xs text-muted">as of {formatMonthLabel(now + '-01', locale)}</span>
      </div>

      <div className="space-y-6">
        {income.length > 0 && <PlanSection title="Income" items={income} sumNow={sumNow} {...rowProps} />}
        {ordered.map((sec) => (
          <PlanSection key={sec} title={sec} items={groups.get(sec)!} sumNow={sumNow} {...rowProps} />
        ))}
      </div>

      {adding && <AddLineModal flow={adding} locale={locale} onClose={() => setAdding(null)} onAdd={onAdd} />}
      {editingItem && (
        <EditLineModal
          item={editingItem}
          months={months}
          currency={currency}
          locale={locale}
          onClose={() => setEditingId(null)}
          onField={(fields) => commitField(editingItem.id, fields)}
          onBulk={(mode, value, from, to) => applyBulk(editingItem.id, mode, value, from, to)}
          onRemove={() => removeRow(editingItem.id)}
        />
      )}
    </div>
  )
}

interface RowProps {
  months: string[]
  locale: string
  fx: (n: number) => string
  overrideOpenId: string | null
  setOverrideOpenId: (id: string | null) => void
  onField: (id: string, fields: Partial<RecurringItem>) => void
  onOverride: (id: string, month: string, value: number) => void
  onClearOverride: (id: string, month: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
}

function PlanSection({
  title,
  items,
  sumNow,
  months,
  ...rest
}: RowProps & { title: string; items: RecurringItem[]; sumNow: (items: RecurringItem[]) => number }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-forest">{title}</h4>
        <span className="text-xs text-muted tabular-nums">{rest.fx(sumNow(items))}/mo</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <PlanLineRow key={item.id} item={item} months={months} {...rest} />
        ))}
      </div>
    </div>
  )
}

function PlanLineRow({
  item,
  months,
  locale,
  fx,
  overrideOpenId,
  setOverrideOpenId,
  onField,
  onOverride,
  onClearOverride,
  onEdit,
  onRemove,
}: RowProps & { item: RecurringItem }) {
  // Only months that genuinely differ from what the cadence implies are worth
  // showing. A plan edited in the old grid stores an explicit value for every
  // month, but one that just restates "€1,850 every month" is not an override
  // — listing those buried the real exceptions in noise.
  const stored = item.monthly ?? {}
  const exceptions = months
    .filter((m) => Object.prototype.hasOwnProperty.call(stored, m))
    .filter((m) => {
      const v = stored[m]
      return (
        typeof v === 'number' &&
        !Number.isNaN(v) &&
        Math.abs(v - itemBaseAmountForMonth(item, m)) > 0.005
      )
    })
  const MAX_CHIPS = 4
  const [showAllExceptions, setShowAllExceptions] = useState(false)
  const shownExceptions = showAllExceptions ? exceptions : exceptions.slice(0, MAX_CHIPS)
  const hiddenExceptions = exceptions.length - shownExceptions.length

  const overrideOpen = overrideOpenId === item.id
  const [overrideMonth, setOverrideMonth] = useState(months[0] ?? '')
  const [overrideAmount, setOverrideAmount] = useState('')

  function saveOverride() {
    const v = parseAmount(overrideAmount)
    if (!overrideMonth || Number.isNaN(v)) return
    onOverride(item.id, overrideMonth, Math.abs(v))
    setOverrideAmount('')
    setOverrideOpenId(null)
  }

  return (
    <div className="rounded-lg border border-line bg-canvas/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <input
          className="bg-transparent text-sm font-medium outline-none min-w-0 flex-1 focus:text-forest"
          defaultValue={item.label}
          onBlur={(e) => onField(item.id, { label: e.target.value.trim() || item.label })}
        />
        {item.flow === 'expense' && (
          <select
            className="bg-transparent text-[11px] text-muted outline-none cursor-pointer hover:text-forest shrink-0"
            defaultValue={item.category}
            onChange={(e) => onField(item.id, { category: e.target.value })}
          >
            {expenseCats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="text"
            inputMode="decimal"
            className="bg-transparent text-right text-sm tabular-nums outline-none w-20 focus:text-forest"
            defaultValue={item.amount}
            onBlur={(e) => {
              const v = parseAmount(e.target.value)
              if (!Number.isNaN(v) && v >= 0) onField(item.id, { amount: v })
            }}
          />
          <select
            className="bg-transparent text-xs text-muted outline-none cursor-pointer hover:text-forest"
            defaultValue={item.cadence}
            onChange={(e) => onField(item.id, { cadence: e.target.value as Cadence })}
          >
            {CADENCES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <button
            className={classNames('transition', overrideOpen ? 'text-forest' : 'text-muted hover:text-forest')}
            onClick={() => setOverrideOpenId(overrideOpen ? null : item.id)}
            title="Override a single month"
            aria-label="Override a single month"
          >
            <IconMoneyDate width={15} height={15} />
          </button>
          <button
            className="text-muted hover:text-forest"
            onClick={() => onEdit(item.id)}
            title="Rename, change dates, or edit a range of months"
            aria-label="Edit line"
          >
            <IconEdit width={14} height={14} />
          </button>
          <button
            className="text-muted hover:text-clay"
            onClick={() => onRemove(item.id)}
            aria-label="Delete line"
          >
            <IconTrash width={14} height={14} />
          </button>
        </div>
      </div>

      {(item.cadence !== 'monthly' || exceptions.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">
          {item.cadence !== 'monthly' && (
            <span className="text-muted">
              {CADENCE_LABEL.get(item.cadence)?.toLowerCase()} · ~{fx(round2(itemBaseAmountForMonth(item, item.startDate.slice(0, 7))))} when it lands
            </span>
          )}
          {shownExceptions.map((m) => (
            <span key={m} className="pill bg-gold/10 text-ink inline-flex items-center gap-1">
              {formatMonthLabel(m + '-01', locale)}: {fx(stored[m])}
              <button
                className="text-muted hover:text-clay"
                onClick={() => onClearOverride(item.id, m)}
                aria-label={`Remove override for ${formatMonthLabel(m + '-01', locale)}`}
              >
                <IconClose width={10} height={10} />
              </button>
            </span>
          ))}
          {hiddenExceptions > 0 && (
            <button className="text-muted hover:text-forest underline" onClick={() => setShowAllExceptions(true)}>
              +{hiddenExceptions} more
            </button>
          )}
          {showAllExceptions && exceptions.length > MAX_CHIPS && (
            <button className="text-muted hover:text-forest underline" onClick={() => setShowAllExceptions(false)}>
              Show less
            </button>
          )}
        </div>
      )}

      {overrideOpen && (
        <div className="flex flex-wrap items-end gap-2 mt-2.5 pt-2.5 border-t border-line/60">
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Month</label>
            <select
              className="input py-1 text-xs w-auto"
              value={overrideMonth}
              onChange={(e) => setOverrideMonth(e.target.value)}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m + '-01', locale)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Amount that month</label>
            <input
              type="text"
              inputMode="decimal"
              className="input py-1 text-xs w-24 tabular-nums"
              placeholder={String(round2(itemAmountForMonth(item, overrideMonth)))}
              value={overrideAmount}
              onChange={(e) => setOverrideAmount(e.target.value)}
              autoFocus
            />
          </div>
          <button className="btn-primary text-xs py-1.5 px-3" onClick={saveOverride}>
            Save
          </button>
          <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setOverrideOpenId(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
