import { useState } from 'react'
import { useData } from '../store'
import { CATEGORIES } from '../lib/categorize'
import {
  isPlannedSetAside,
  itemAmountForMonth,
  itemBaseAmountForMonth,
  planMonths,
  planSection,
} from '../lib/forecast'
import { formatMoney, formatMonthLabel, shortMonth, classNames, parseAmount } from '../lib/format'
import type { Cadence, Flow, RecurringItem } from '../lib/types'
import { IconPlus, IconTrash, IconEdit, IconMoneyDate } from './icons'
import { AddLineModal, CADENCES } from './AddLineModal'
import { EditLineModal } from './EditLineModal'

// One row per recurring line, grouped into sections (Fixed / Provisions /
// Variable …) with a live subtotal. The amount + cadence covers the common
// case; a line whose months differ says so in one line of text and opens an
// inline month-by-month schedule on demand — so the precision of the old grid
// is still there, but for one line at a time instead of all of them at once.

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
  const [scheduleOpenId, setScheduleOpenId] = useState<string | null>(null)
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
    if (scheduleOpenId === id) setScheduleOpenId(null)
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

  function resetSchedule(id: string, scope: string[]) {
    update((d) => {
      const it = d.recurring.find((r) => r.id === id)
      if (it?.monthly) {
        const next = { ...it.monthly }
        for (const m of scope) delete next[m]
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
  // Split the same way the forecast and the money date split it: money put into
  // a provision is set aside, not spent. Summing it into expenses here was what
  // made the plan's own total disagree with every figure derived from it.
  const incomeNow = sumNow(income)
  const setAsideNow = sumNow(expense.filter(isPlannedSetAside))
  const expenseNow = sumNow(expense.filter((it) => !isPlannedSetAside(it)))
  const netNow = incomeNow - expenseNow - setAsideNow
  const fx = (n: number) => formatMoney(n, currency, locale)

  const rowProps = {
    months,
    locale,
    fx,
    scheduleOpenId,
    setScheduleOpenId,
    onField: commitField,
    onOverride: setOverride,
    onClearOverride: clearOverride,
    onResetSchedule: resetSchedule,
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
        {setAsideNow > 0.005 && (
          <span className="text-muted">
            Set aside <span className="text-ink font-medium tabular-nums">{fx(setAsideNow)}</span>/mo
          </span>
        )}
        <span className="text-muted">
          Net result{' '}
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
  scheduleOpenId: string | null
  setScheduleOpenId: (id: string | null) => void
  onField: (id: string, fields: Partial<RecurringItem>) => void
  onOverride: (id: string, month: string, value: number) => void
  onResetSchedule: (id: string, scope: string[]) => void
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
  scheduleOpenId,
  setScheduleOpenId,
  onField,
  onOverride,
  onClearOverride,
  onResetSchedule,
  onEdit,
  onRemove,
}: RowProps & { item: RecurringItem }) {
  // A month counts as "set differently" only when its stored value differs from
  // what the cadence and base amount imply. A plan edited in the old grid stores
  // a value for every month, but one that merely restates "1,850 every month"
  // is not a change worth surfacing.
  const stored = item.monthly ?? {}
  const isException = (m: string) => {
    const v = stored[m]
    return (
      Object.prototype.hasOwnProperty.call(stored, m) &&
      typeof v === 'number' &&
      !Number.isNaN(v) &&
      Math.abs(v - itemBaseAmountForMonth(item, m)) > 0.005
    )
  }
  const exceptions = months.filter(isException)
  const open = scheduleOpenId === item.id

  function commitMonth(m: string, raw: string) {
    const v = parseAmount(raw)
    if (Number.isNaN(v)) return
    // Typing the line's normal amount back in clears the override, so the
    // schedule never fills up with values that say nothing.
    if (Math.abs(v - itemBaseAmountForMonth(item, m)) <= 0.005) onClearOverride(item.id, m)
    else onOverride(item.id, m, v)
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
            className={classNames('transition', open ? 'text-forest' : 'text-muted hover:text-forest')}
            onClick={() => setScheduleOpenId(open ? null : item.id)}
            title="Month-by-month schedule"
            aria-label="Month-by-month schedule"
            aria-expanded={open}
          >
            <IconMoneyDate width={15} height={15} />
          </button>
          <button
            className="text-muted hover:text-forest"
            onClick={() => onEdit(item.id)}
            title="Rename, recategorise, or change a range of months"
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

      {!open && (item.cadence !== 'monthly' || exceptions.length > 0) && (
        <div className="mt-1.5 text-[11px] text-muted">
          {item.cadence !== 'monthly' && (
            <span>
              {CADENCE_LABEL.get(item.cadence)?.toLowerCase()} · ~
              {fx(round2(itemBaseAmountForMonth(item, item.startDate.slice(0, 7))))} when it lands
            </span>
          )}
          {item.cadence !== 'monthly' && exceptions.length > 0 && <span> · </span>}
          {exceptions.length > 0 && (
            <button className="underline hover:text-forest" onClick={() => setScheduleOpenId(item.id)}>
              {exceptions.length} {exceptions.length === 1 ? 'month is' : 'months are'} set differently
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="mt-2.5 pt-2.5 border-t border-line/60">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <span className="text-[11px] text-muted">
              Edit any month. Typing the line&rsquo;s normal amount clears that month again.
            </span>
            {exceptions.length > 0 && (
              <button
                className="text-[11px] text-muted hover:text-clay underline"
                onClick={() => onResetSchedule(item.id, months)}
              >
                Reset all months
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
            {months.map((m) => {
              const effective = round2(itemAmountForMonth(item, m))
              const differs = isException(m)
              return (
                <label
                  key={`${m}:${effective}`}
                  className={classNames(
                    'rounded-md border px-2 py-1 cursor-text transition',
                    differs ? 'border-gold/60 bg-gold/10' : 'border-line bg-paper',
                  )}
                >
                  <span className="block text-[10px] text-muted">
                    {shortMonth(m, locale)} {m.slice(2, 4)}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full bg-transparent text-right text-xs tabular-nums outline-none focus:text-forest"
                    defaultValue={effective}
                    onBlur={(e) => commitMonth(m, e.target.value)}
                  />
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
