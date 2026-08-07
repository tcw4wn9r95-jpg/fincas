import { useMemo, useState } from 'react'
import { useData } from '../store'
import type { Transaction } from '../lib/types'
import {
  computeWeek,
  weeksWithSample,
  weekStartOf,
  weekLabel,
  weeklyReviewText,
} from '../lib/weekly'
import { formatMoney, classNames, todayISO } from '../lib/format'
import { ImportModal } from './ImportModal'
import { Sparkline } from './Sparkline'
import { IconUpload, IconChat } from './icons'

export function WeeklyCheckin({ onDiscuss }: { onDiscuss: (prompt: string) => void }) {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const [importing, setImporting] = useState(false)

  const weeks = useMemo(() => {
    const w = weeksWithSample(data)
    return w.length ? w : [weekStartOf(todayISO())]
  }, [data])
  const [week, setWeek] = useState(weeks[0])
  const activeWeek = weeks.includes(week) ? week : weeks[0]

  const review = useMemo(() => computeWeek(data, activeWeek), [data, activeWeek])
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, { round: true, ...opts })

  const hasData = (data.sampleTransactions?.length ?? 0) > 0
  const hasPlan = review.monthlyVariablePlan > 0

  // Append a fresh Revolut export, skipping rows we already have (users re-upload
  // overlapping windows week to week).
  function importSample(rows: Transaction[]) {
    update((d) => {
      const existing = d.sampleTransactions ?? []
      const seen = new Set(existing.map((t) => `${t.date}|${t.amount}|${t.description}`))
      const fresh = rows.filter((t) => !seen.has(`${t.date}|${t.amount}|${t.description}`))
      d.sampleTransactions = [...existing, ...fresh]
      return d
    })
  }

  function discuss() {
    const prompt =
      weeklyReviewText(data, activeWeek, locale) +
      '\n\nBased on this week of variable spending, am I on track for the month, and what should I trim?'
    onDiscuss(prompt)
  }

  const overBudget = review.vsBudget > 0
  const pacePct = review.weeklyBudget > 0 ? Math.round((review.spend / review.weeklyBudget) * 100) : 0

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl">Weekly check-in</h2>
          <p className="text-muted">A fast pulse on variable spending, from your Revolut export</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {hasData && (
            <select
              className="input w-auto"
              value={activeWeek}
              onChange={(e) => setWeek(e.target.value)}
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w, locale)}
                </option>
              ))}
            </select>
          )}
          {hasData && (
            <button className="btn-ghost" onClick={discuss}>
              <IconChat width={16} height={16} /> Discuss
            </button>
          )}
          <button className="btn-primary" onClick={() => setImporting(true)}>
            <IconUpload width={16} height={16} /> Import Revolut
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="card p-8 text-center">
          <p className="text-muted max-w-md mx-auto">
            The weekly check-in reads a sample of your variable spending — export your
            transactions from Revolut (CSV) and drop them in. It stays separate from your
            monthly money date, so nothing double-counts.
          </p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setImporting(true)}>
            <IconUpload width={16} height={16} /> Import Revolut export
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-5">
              <div className="label">Spent this week</div>
              <div className="stat-value text-clay">{fx(review.spend)}</div>
              <div className="text-sm text-muted mt-1">
                {review.count} {review.count === 1 ? 'transaction' : 'transactions'}
                {review.daysElapsed < 7 &&
                  review.daysElapsed > 0 &&
                  ` · ${review.daysElapsed} ${review.daysElapsed === 1 ? 'day' : 'days'} in`}
              </div>
            </div>
            <div className="card p-5">
              <div className="label">Weekly budget</div>
              <div className="stat-value">{hasPlan ? fx(review.weeklyBudget) : '—'}</div>
              <div
                className={classNames(
                  'text-sm mt-1',
                  !hasPlan ? 'text-muted' : overBudget ? 'text-clay' : 'text-forest',
                )}
              >
                {hasPlan
                  ? `${fx(Math.abs(review.vsBudget))} ${overBudget ? 'over' : 'under'}`
                  : 'Add variable lines to your plan'}
              </div>
            </div>
            <div className="card p-5">
              <div className="label">Month at this pace</div>
              <div
                className={classNames(
                  'stat-value',
                  hasPlan && review.vsPlanMonthly > 0 ? 'text-clay' : 'text-ink',
                )}
              >
                {review.paceMonthly > 0 ? fx(review.paceMonthly) : '—'}
              </div>
              <div
                className={classNames(
                  'text-sm mt-1',
                  !hasPlan ? 'text-muted' : review.vsPlanMonthly > 0 ? 'text-clay' : 'text-forest',
                )}
              >
                {hasPlan
                  ? `${fx(Math.abs(review.vsPlanMonthly), { signed: false })} ${review.vsPlanMonthly > 0 ? 'over' : 'under'} plan`
                  : `plan not set`}
              </div>
            </div>
          </div>

          {hasPlan && (
            <div className="card p-5">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-lg">Pace against budget</h3>
                <span
                  className={classNames(
                    'pill',
                    overBudget ? 'bg-clay/10 text-clay' : 'bg-forest-tint text-forest',
                  )}
                >
                  {pacePct}% of weekly budget
                </span>
              </div>
              <div className="h-3 rounded-full bg-line overflow-hidden">
                <div
                  className={classNames('h-full rounded-full', overBudget ? 'bg-clay' : 'bg-forest')}
                  style={{ width: `${Math.min(100, pacePct)}%` }}
                />
              </div>
              <p className="text-sm text-muted mt-2">
                {overBudget
                  ? `You're ahead of your weekly variable budget of ${fx(review.weeklyBudget)}. At this rate the month lands near ${fx(review.paceMonthly)}.`
                  : `You're within your weekly variable budget of ${fx(review.weeklyBudget)}. Room to spare: ${fx(Math.abs(review.vsBudget))}.`}
              </p>
            </div>
          )}

          {review.series.length >= 2 && (
            <div className="card p-5 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg">Week over week</h3>
                <p className="text-sm text-muted">
                  {review.delta >= 0 ? 'Up' : 'Down'} {fx(Math.abs(review.delta))} vs last week (
                  {fx(review.prevSpend)})
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Sparkline
                  values={review.series}
                  width={110}
                  height={34}
                  color={review.delta > 0 ? '#b95f38' : '#2e5347'}
                />
                <span
                  className={classNames(
                    'text-lg font-serif tabular-nums',
                    review.delta > 0 ? 'text-clay' : 'text-forest',
                  )}
                >
                  {review.delta >= 0 ? '▲' : '▼'}
                </span>
              </div>
            </div>
          )}

          {review.byCategory.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-6 pt-5 pb-2">
                <h3 className="text-lg">Where it went this week</h3>
                <p className="text-sm text-muted">Variable spend by category</p>
              </div>
              <div className="px-6 pb-5 pt-2 space-y-2.5">
                {review.byCategory.map((c) => {
                  const share = review.spend > 0 ? (c.amount / review.spend) * 100 : 0
                  return (
                    <div key={c.category} className="flex items-center gap-3">
                      <span className="text-sm text-ink w-28 truncate">{c.category}</span>
                      <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
                        <div className="h-full bg-forest/40 rounded-full" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-sm tabular-nums text-ink w-20 text-right">{fx(c.amount)}</span>
                      <span className="text-xs tabular-nums text-muted w-10 text-right">
                        {Math.round(share)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          title="Import Revolut export"
          subtitle="CSV from Revolut — a sample of your variable spending, parsed on your device"
          existing={data.sampleTransactions ?? []}
          onImport={importSample}
        />
      )}
    </div>
  )
}
