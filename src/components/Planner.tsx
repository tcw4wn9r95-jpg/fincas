import { useData } from '../store'
import { CATEGORIES } from '../lib/categorize'
import { itemAmountForMonth, planMonths, totalBalance } from '../lib/forecast'
import { formatMoney, shortMonth, classNames, uid, currentMonth } from '../lib/format'
import type { Flow, RecurringItem } from '../lib/types'
import { IconPlus, IconTrash } from './icons'

// A spreadsheet-style editor: rows are plan lines, columns are months. Every
// cell is editable, and lines are grouped into sections (Fixed / Provisions /
// Variable …) with live subtotals — mirroring the original spreadsheet.

const expenseCats = CATEGORIES.filter((c) => c !== 'Income')

const FIXED = new Set(['Loans', 'Utilities', 'Insurance', 'Subscriptions', 'Entertainment'])
const PROVISION = new Set(['Taxes', 'Provisions', 'Travel'])
const SECTION_ORDER = ['Fixed monthly', 'Provisions', 'Variable']

function sectionOf(item: RecurringItem): string {
  if (item.group) return item.group
  if (FIXED.has(item.category)) return 'Fixed monthly'
  if (PROVISION.has(item.category)) return 'Provisions'
  return 'Variable'
}

type DisplayRow =
  | { kind: 'section'; label: string }
  | { kind: 'item'; item: RecurringItem }
  | { kind: 'total'; label: string; values: number[]; tone: TotalTone; strong?: boolean }

type TotalTone = 'income' | 'expense' | 'net' | 'balance' | 'sub'

export function Planner() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const months = planMonths(data)

  const income = data.recurring.filter((r) => r.flow === 'income')
  const expense = data.recurring.filter((r) => r.flow === 'expense')

  function commitCell(id: string, month: string, raw: string) {
    const value = raw.trim() === '' ? 0 : Number(raw)
    if (Number.isNaN(value)) return
    update((d) => {
      const it = d.recurring.find((r) => r.id === id)
      if (it) it.monthly = { ...(it.monthly ?? {}), [month]: value }
      return d
    })
  }
  function commitField(id: string, fields: Partial<RecurringItem>) {
    update((d) => {
      const it = d.recurring.find((r) => r.id === id)
      if (it) Object.assign(it, fields)
      return d
    })
  }
  function addRow(flow: Flow) {
    update((d) => {
      d.recurring.push({
        id: uid(),
        label: flow === 'income' ? 'New income' : 'New expense',
        amount: 0,
        flow,
        cadence: 'monthly',
        category: flow === 'income' ? 'Income' : 'Other',
        startDate: currentMonth() + '-01',
        monthly: {},
      })
      return d
    })
  }
  function removeRow(id: string) {
    update((d) => {
      d.recurring = d.recurring.filter((r) => r.id !== id)
      return d
    })
  }

  const sum = (items: RecurringItem[], m: string) =>
    items.reduce((s, it) => s + itemAmountForMonth(it, m), 0)

  const incomeTotals = months.map((m) => sum(income, m))

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

  const committed = ordered.filter((s) => s !== 'Variable')
  const committedTotals = months.map((m) =>
    committed.reduce((s, sec) => s + sum(groups.get(sec)!, m), 0),
  )
  const expenseTotals = months.map((m) => sum(expense, m))
  const nets = months.map((_, i) => incomeTotals[i] - expenseTotals[i])
  let running = totalBalance(data)
  const balances = nets.map((n) => (running += n))

  // Build the ordered list of display rows.
  const rows: DisplayRow[] = [{ kind: 'section', label: 'Income' }]
  income.forEach((item) => rows.push({ kind: 'item', item }))
  rows.push({ kind: 'total', label: 'Total income', values: incomeTotals, tone: 'income', strong: true })

  for (const sec of ordered) {
    if (sec === 'Variable' && committed.length) {
      const afterFixed = months.map((_, i) => incomeTotals[i] - committedTotals[i])
      rows.push({ kind: 'total', label: 'After fixed costs', values: afterFixed, tone: 'net' })
    }
    rows.push({ kind: 'section', label: sec })
    groups.get(sec)!.forEach((item) => rows.push({ kind: 'item', item }))
    rows.push({
      kind: 'total',
      label: `${sec} subtotal`,
      values: months.map((m) => sum(groups.get(sec)!, m)),
      tone: 'sub',
    })
  }

  rows.push({ kind: 'total', label: 'Total expenses', values: expenseTotals, tone: 'expense', strong: true })
  rows.push({ kind: 'total', label: 'Net', values: nets, tone: 'net', strong: true })
  rows.push({ kind: 'total', label: 'Projected balance', values: balances, tone: 'balance', strong: true })

  const fx = (n: number) => formatMoney(n, currency, locale)
  const colW = 86

  if (data.recurring.length === 0) {
    return (
      <div className="card p-6">
        <h3 className="text-lg">Monthly planner</h3>
        <p className="text-sm text-muted mb-4">
          A spreadsheet-style view of your plan — every month is editable.
        </p>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => addRow('income')}>
            <IconPlus width={16} height={16} /> Income line
          </button>
          <button className="btn-ghost" onClick={() => addRow('expense')}>
            <IconPlus width={16} height={16} /> Expense line
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden" key={data.updatedAt}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-5 pb-3">
        <div>
          <h3 className="text-lg">Monthly planner</h3>
          <p className="text-sm text-muted">
            Edit any cell — values feed the forecast. Scroll sideways for more months.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={() => addRow('income')}>
            <IconPlus width={14} height={14} /> Income
          </button>
          <button className="btn-ghost text-xs" onClick={() => addRow('expense')}>
            <IconPlus width={14} height={14} /> Expense
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-paper text-left font-medium text-muted px-3 py-2 border-b border-line min-w-[220px]">
                Line
              </th>
              {months.map((m, i) => (
                <th
                  key={m}
                  className={classNames(
                    'px-2 py-2 text-right font-medium border-b border-line whitespace-nowrap',
                    i === 0 ? 'text-forest' : 'text-muted',
                  )}
                  style={{ minWidth: colW }}
                >
                  {shortMonth(m, locale)} {m.slice(2, 4)}
                  {i === 0 && <div className="text-[10px] font-normal">now</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              if (row.kind === 'section')
                return <SectionRow key={`s${i}`} label={row.label} span={months.length + 1} />
              if (row.kind === 'item')
                return (
                  <PlanRow
                    key={row.item.id}
                    item={row.item}
                    months={months}
                    colW={colW}
                    onCell={commitCell}
                    onField={commitField}
                    onRemove={removeRow}
                  />
                )
              return (
                <TotalRow
                  key={`t${i}`}
                  label={row.label}
                  values={row.values}
                  fx={fx}
                  tone={row.tone}
                  strong={row.strong}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SectionRow({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <td
        colSpan={span}
        className="sticky left-0 bg-forest-tint/50 text-forest text-xs font-semibold uppercase tracking-wide px-3 py-1.5 border-b border-line"
      >
        {label}
      </td>
    </tr>
  )
}

function PlanRow({
  item,
  months,
  colW,
  onCell,
  onField,
  onRemove,
}: {
  item: RecurringItem
  months: string[]
  colW: number
  onCell: (id: string, month: string, raw: string) => void
  onField: (id: string, fields: Partial<RecurringItem>) => void
  onRemove: (id: string) => void
}) {
  return (
    <tr className="group hover:bg-canvas/60">
      <td className="sticky left-0 z-10 bg-paper group-hover:bg-canvas/60 px-3 py-1.5 border-b border-line/60 align-middle">
        <div className="flex items-center gap-1.5">
          <button
            className="text-muted hover:text-clay opacity-0 group-hover:opacity-100 transition"
            onClick={() => onRemove(item.id)}
            aria-label="Remove line"
          >
            <IconTrash width={14} height={14} />
          </button>
          <input
            className="bg-transparent text-sm font-medium outline-none w-28 focus:text-forest"
            defaultValue={item.label}
            onBlur={(e) => onField(item.id, { label: e.target.value.trim() || item.label })}
          />
          <select
            className="bg-transparent text-[11px] text-muted outline-none cursor-pointer hover:text-forest max-w-[88px]"
            defaultValue={item.category}
            onChange={(e) => onField(item.id, { category: e.target.value })}
          >
            {item.flow === 'income' ? (
              <option value="Income">Income</option>
            ) : (
              expenseCats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))
            )}
          </select>
        </div>
      </td>
      {months.map((m) => (
        <td key={m} className="border-b border-line/60 p-0" style={{ minWidth: colW }}>
          <input
            type="number"
            step="0.01"
            defaultValue={round2(itemAmountForMonth(item, m))}
            onBlur={(e) => onCell(item.id, m, e.target.value)}
            className="w-full bg-transparent text-right text-sm px-2 py-1.5 outline-none tabular-nums text-ink focus:bg-forest-tint/40 focus:text-forest"
          />
        </td>
      ))}
    </tr>
  )
}

function TotalRow({
  label,
  values,
  fx,
  tone,
  strong,
}: {
  label: string
  values: number[]
  fx: (n: number) => string
  tone: TotalTone
  strong?: boolean
}) {
  return (
    <tr className={classNames(strong && 'border-t-2 border-line')}>
      <td
        className={classNames(
          'sticky left-0 bg-paper px-3 py-1.5 border-b border-line text-xs uppercase tracking-wide',
          strong ? 'font-semibold text-ink' : tone === 'sub' ? 'font-medium text-ink/70' : 'font-medium text-muted',
        )}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={classNames(
            'px-2 py-1.5 text-right border-b border-line tabular-nums whitespace-nowrap',
            tone === 'income' && 'text-forest',
            tone === 'expense' && 'text-clay',
            tone === 'sub' && 'text-ink/70',
            tone === 'net' && (v >= 0 ? 'text-forest font-medium' : 'text-clay font-medium'),
            tone === 'balance' && (v >= 0 ? 'text-ink font-medium' : 'text-clay font-medium'),
          )}
        >
          {fx(v)}
        </td>
      ))}
    </tr>
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
