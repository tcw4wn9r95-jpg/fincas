import { useMemo, useState } from 'react'
import { useData } from '../store'
import {
  computeReview,
  monthsWithData,
  actualsByCategory,
  itemAmountForMonth,
  spendSeriesByCategory,
  streak,
} from '../lib/forecast'
import { formatMoney, formatMonthLabel, shortMonth, classNames, currentMonth } from '../lib/format'
import { ImportModal } from './ImportModal'
import { Sparkline } from './Sparkline'
import { IconUpload, IconChat } from './icons'

function VarianceBar({ planned, actual }: { planned: number; actual: number }) {
  const max = Math.max(planned, actual, 1)
  return (
    <div className="space-y-1 min-w-[120px]">
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div className="h-full bg-forest/30" style={{ width: `${(planned / max) * 100}%` }} />
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div
          className={classNames('h-full', actual > planned ? 'bg-clay' : 'bg-sage')}
          style={{ width: `${(actual / max) * 100}%` }}
        />
      </div>
    </div>
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface TrendRow {
  cat: string
  vals: number[]
  current: number
  prev: number
  delta: number
  run: number
}

export function MoneyDate({ onDiscuss }: { onDiscuss: (month: string) => void }) {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const [importing, setImporting] = useState(false)
  const [applied, setApplied] = useState('')

  const months = useMemo(() => {
    const withData = monthsWithData(data)
    return withData.length ? withData : [currentMonth()]
  }, [data])
  const [month, setMonth] = useState(months[0])
  const activeMonth = months.includes(month) ? month : months[0]

  const review = useMemo(() => computeReview(data, activeMonth), [data, activeMonth])
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, opts)

  const netVsPlan = review.net - review.plannedNet
  const incomeRows = review.categories.filter((c) => c.flow === 'income')
  const expenseRows = review.categories.filter((c) => c.flow === 'expense')

  // The headline of a money date: the two or three places the month actually
  // went off plan, before the full table.
  const overPlan = expenseRows
    .filter((c) => c.variance > 5)
    .sort((a, b) => b.variance - a.variance)
    .slice(0, 3)
  const underPlan = expenseRows
    .filter((c) => c.variance < -5)
    .sort((a, b) => a.variance - b.variance)
    .slice(0, 2)

  // Closing the loop: how far this month's plan still differs from its actuals,
  // over the categories that actually have transactions.
  const reconcileGap = useMemo(() => {
    const { income, expense } = actualsByCategory(data, activeMonth)
    let gap = 0
    for (const [cat, actual] of Object.entries(expense)) {
      const planned = data.recurring
        .filter((r) => r.flow === 'expense' && r.category === cat)
        .reduce((s, r) => s + itemAmountForMonth(r, activeMonth), 0)
      gap += Math.abs(actual - planned)
    }
    for (const [cat, actual] of Object.entries(income)) {
      const planned = data.recurring
        .filter((r) => r.flow === 'income' && r.category === cat)
        .reduce((s, r) => s + itemAmountForMonth(r, activeMonth), 0)
      gap += Math.abs(actual - planned)
    }
    return gap
  }, [data, activeMonth])
  const inSync = reconcileGap < 1

  // Month-over-month trends: actual spend per category across recent months.
  const trends = useMemo(() => {
    const hist = monthsWithData(data)
      .filter((m) => m <= activeMonth)
      .sort()
      .slice(-6)
    if (hist.length < 2) return { months: hist as string[], rows: [] as TrendRow[], streaks: [] as TrendRow[] }
    const series = spendSeriesByCategory(data, hist)
    const rows: TrendRow[] = Object.entries(series).map(([cat, vals]) => {
      const current = vals[vals.length - 1]
      const prev = vals[vals.length - 2]
      return { cat, vals, current, prev, delta: current - prev, run: streak(vals) }
    })
    rows.sort((a, b) => b.current - a.current)
    const streaks = rows
      .filter((r) => Math.abs(r.run) >= 3 && r.current > 5)
      .sort((a, b) => Math.abs(b.run) - Math.abs(a.run))
    return { months: hist, rows: rows.filter((r) => r.current > 0).slice(0, 8), streaks }
  }, [data, activeMonth])

  // Overwrite this month's plan values with the imported actuals, category by
  // category — so the plan (and the forecast that rolls through it) reflects
  // what actually happened. Multi-line categories scale proportionally.
  function matchPlanToActuals() {
    if (
      !confirm(
        `Replace your plan's ${formatMonthLabel(activeMonth, locale)} amounts with the imported actuals? Only this month changes; you can still edit any line afterwards.`,
      )
    )
      return
    update((d) => {
      const { income, expense } = actualsByCategory(d, activeMonth)
      const apply = (map: Record<string, number>, flow: 'income' | 'expense') => {
        for (const [cat, actual] of Object.entries(map)) {
          const lines = d.recurring.filter((r) => r.flow === flow && r.category === cat)
          if (!lines.length) continue
          const planned = lines.reduce((s, l) => s + itemAmountForMonth(l, activeMonth), 0)
          if (lines.length === 1 || planned <= 0) {
            lines[0].monthly = { ...(lines[0].monthly ?? {}), [activeMonth]: round2(actual) }
            for (let i = 1; i < lines.length; i++) {
              lines[i].monthly = { ...(lines[i].monthly ?? {}), [activeMonth]: 0 }
            }
          } else {
            for (const l of lines) {
              const cur = itemAmountForMonth(l, activeMonth)
              l.monthly = { ...(l.monthly ?? {}), [activeMonth]: round2((cur * actual) / planned) }
            }
          }
        }
      }
      apply(income, 'income')
      apply(expense, 'expense')
      return d
    })
    setApplied(activeMonth)
    setTimeout(() => setApplied(''), 3000)
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl">Money date</h2>
          <p className="text-muted">Where you actually stand vs. your plan</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            className="input w-auto"
            value={activeMonth}
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m, locale)}
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={() => onDiscuss(activeMonth)}>
            <IconChat width={16} height={16} /> Discuss
          </button>
          <button className="btn-primary" onClick={() => setImporting(true)}>
            <IconUpload width={16} height={16} /> Import statement
          </button>
        </div>
      </div>

      {review.transactionCount === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-muted max-w-md mx-auto">
            No transactions for {formatMonthLabel(activeMonth, locale)} yet. Import a CSV or
            PDF statement to start your money date.
          </p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setImporting(true)}>
            <IconUpload width={16} height={16} /> Import statement
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-5">
              <div className="label">Money in</div>
              <div className="stat-value text-forest">{fx(review.income)}</div>
              <div className="text-sm text-muted mt-1">
                planned {fx(review.plannedIncome)}
              </div>
            </div>
            <div className="card p-5">
              <div className="label">Money out</div>
              <div className="stat-value text-clay">{fx(review.expenses)}</div>
              <div className="text-sm text-muted mt-1">
                planned {fx(review.plannedExpenses)}
              </div>
            </div>
            <div className="card p-5">
              <div className="label">Net</div>
              <div
                className={classNames(
                  'stat-value',
                  review.net >= 0 ? 'text-forest' : 'text-clay',
                )}
              >
                {fx(review.net, { signed: true })}
              </div>
              <div
                className={classNames(
                  'text-sm mt-1',
                  netVsPlan >= 0 ? 'text-forest' : 'text-clay',
                )}
              >
                {fx(netVsPlan, { signed: true })} vs plan
              </div>
            </div>
          </div>

          {/* Close the loop: make the plan (and forecast) reflect what happened */}
          <div className="card p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg">Close the loop</h3>
              <p className="text-sm text-muted">
                {applied === activeMonth
                  ? `Plan updated for ${formatMonthLabel(activeMonth, locale)} — your forecast now builds on these actuals.`
                  : inSync
                    ? `Your plan for ${formatMonthLabel(activeMonth, locale)} already matches these actuals.`
                    : `Match your plan for ${formatMonthLabel(activeMonth, locale)} to what actually happened, so the forecast builds on reality.`}
              </p>
            </div>
            {applied === activeMonth || inSync ? (
              <span className="pill bg-forest-tint text-forest shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-sage" /> In sync
              </span>
            ) : (
              <button className="btn-primary shrink-0" onClick={matchPlanToActuals}>
                Match plan to actuals
              </button>
            )}
          </div>

          {(overPlan.length > 0 || underPlan.length > 0) && (
            <div className="card p-5">
              <h3 className="text-lg mb-3">Where it went off plan</h3>
              <div className="flex flex-wrap gap-2">
                {overPlan.map((c) => (
                  <span key={c.category} className="pill bg-clay/10 text-clay">
                    {c.category} {fx(c.variance)} over
                  </span>
                ))}
                {underPlan.map((c) => (
                  <span key={c.category} className="pill bg-forest-tint text-forest">
                    {c.category} {fx(Math.abs(c.variance))} under
                  </span>
                ))}
              </div>
            </div>
          )}

          {trends.months.length >= 2 && trends.rows.length > 0 && (
            <div className="card p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg">Trends</h3>
                <span className="text-xs text-muted">
                  actual spend · {shortMonth(trends.months[0], locale)}–
                  {shortMonth(trends.months[trends.months.length - 1], locale)}
                </span>
              </div>

              {trends.streaks.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  {trends.streaks.slice(0, 3).map((r) => {
                    const rising = r.run > 0
                    return (
                      <div key={r.cat} className="flex items-center gap-2 text-sm">
                        <span className={rising ? 'text-clay' : 'text-forest'}>
                          {rising ? '▲' : '▼'}
                        </span>
                        <span className="text-ink">
                          <span className="font-medium">{r.cat}</span>{' '}
                          {rising ? 'up' : 'down'} {Math.abs(r.run)} months in a row
                        </span>
                        <span className="text-muted tabular-nums">
                          {fx(r.vals[r.vals.length - Math.abs(r.run) - 1] ?? r.prev)} → {fx(r.current)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
                {trends.rows.map((r) => {
                  const up = r.delta > 0.5
                  const down = r.delta < -0.5
                  return (
                    <div key={r.cat} className="flex items-center gap-3 py-1">
                      <span className="text-sm text-ink w-24 truncate">{r.cat}</span>
                      <Sparkline values={r.vals} color={up ? '#b95f38' : '#2e5347'} />
                      <span className="ml-auto text-sm tabular-nums text-ink">{fx(r.current)}</span>
                      <span
                        className={classNames(
                          'text-xs tabular-nums w-14 text-right',
                          up ? 'text-clay' : down ? 'text-forest' : 'text-muted',
                        )}
                      >
                        {up ? '▲' : down ? '▼' : '–'}{' '}
                        {r.prev > 0 ? `${Math.round((r.delta / r.prev) * 100)}%` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-6 pt-5 pb-2">
              <h3 className="text-lg">By category</h3>
              <p className="text-sm text-muted">
                Top bar = planned · bottom bar = actual ·{' '}
                <span className="text-clay">red</span> means over plan
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-y border-line">
                    <th className="px-6 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium">Plan vs actual</th>
                    <th className="px-4 py-2.5 font-medium text-right">Planned</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actual</th>
                    <th className="px-6 py-2.5 font-medium text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {[...incomeRows, ...expenseRows].map((c) => {
                    // For expenses, spending more than planned is "bad" (clay).
                    // For income, earning less than planned is "bad" (clay).
                    const unfavourable =
                      c.flow === 'expense' ? c.variance > 0 : c.variance < 0
                    const label =
                      c.flow === 'income'
                        ? c.variance >= 0
                          ? 'above'
                          : 'below'
                        : c.variance > 0
                          ? 'over'
                          : 'under'
                    return (
                      <tr key={`${c.flow}-${c.category}`} className="border-b border-line/60">
                        <td className="px-6 py-3">
                          <span
                            className={classNames(
                              'pill',
                              c.flow === 'income'
                                ? 'bg-forest-tint text-forest'
                                : 'bg-clay/10 text-clay',
                            )}
                          >
                            {c.category}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <VarianceBar planned={c.planned} actual={c.actual} />
                        </td>
                        <td className="px-4 py-3 text-right text-muted">{fx(c.planned)}</td>
                        <td className="px-4 py-3 text-right font-medium">{fx(c.actual)}</td>
                        <td
                          className={classNames(
                            'px-6 py-3 text-right font-medium',
                            unfavourable ? 'text-clay' : 'text-forest',
                          )}
                        >
                          {fx(Math.abs(c.variance), { signed: false })}
                          <span className="text-xs ml-1 text-muted">{label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {importing && (
        <ImportModal onClose={() => setImporting(false)} existing={data.transactions} />
      )}
    </div>
  )
}
