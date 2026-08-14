import { useMemo, useRef, useState } from 'react'
import { useData } from '../store'
import {
  buildForecast,
  buildLedger,
  forecastHorizon,
  activeScenario,
  applyScenario,
  computeHistory,
  monthsWithData,
  actualsByCategoryRange,
  hasBalanceAnchor,
  buildSummary,
  balanceToday,
  totalBalance,
} from '../lib/forecast'
import { buildSankey, describeSankeyFlow } from '../lib/sankey'
import { provisionCoveredByCategoryRange } from '../lib/provisions'
import { demoData, importData } from '../lib/storage'
import { formatMoney, formatMonthLabel, classNames, currentMonth } from '../lib/format'
import { CashFlowChart } from './CashFlowChart'
import { HistoryChart } from './HistoryChart'
import { SankeyChart } from './SankeyChart'
import { SankeyOverlay } from './SankeyOverlay'
import { ScenarioBar } from './Scenarios'
import { Logo, IconPlan, IconUpload } from './icons'

/** How far the headline chart looks back, and forward. */
const SUMMARY_BACK = 6
const SUMMARY_FORWARD = 12

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'good' | 'warn'
}) {
  return (
    <div className="card p-5">
      <div className="label">{label}</div>
      <div
        className={classNames(
          'stat-value',
          tone === 'good' && 'text-forest',
          tone === 'warn' && 'text-clay',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </div>
  )
}

export function Dashboard({ goTo }: { goTo: (tab: 'plan' | 'settings') => void }) {
  const { data, setData } = useData()
  const { currency, locale } = data.settings
  const fileRef = useRef<HTMLInputElement>(null)

  const forecast = useMemo(() => buildForecast(data, forecastHorizon(data)), [data])
  // The headline chart looks back as well as forward: six settled months with
  // the plan drawn against them, then the plan as it stands today.
  const summary = useMemo(() => buildSummary(data, SUMMARY_BACK, SUMMARY_FORWARD), [data])
  const ledger = useMemo(() => buildLedger(data), [data])
  const history = useMemo(() => computeHistory(data), [data])
  const year = currentMonth().slice(0, 4)
  const yearMonths = useMemo(
    () => monthsWithData(data).filter((m) => m.slice(0, 4) === year),
    [data, year],
  )
  const [sankeyOpen, setSankeyOpen] = useState(false)
  const { yearSankey, yearSankeyInsights } = useMemo(() => {
    const { income, expense, setAside } = actualsByCategoryRange(data, yearMonths, {
      splitSavings: true,
    })
    const covered = provisionCoveredByCategoryRange(data, yearMonths)
    return {
      yearSankey: buildSankey(income, expense, covered, setAside),
      yearSankeyInsights: describeSankeyFlow(income, expense, covered, currency, locale, setAside),
    }
  }, [data, yearMonths, currency, locale])
  const scenario = activeScenario(data)
  const scenarioOverlay = useMemo(
    () =>
      scenario
        ? {
            name: scenario.name,
            points: buildForecast(applyScenario(data, scenario), forecastHorizon(data)),
          }
        : undefined,
    [data, scenario],
  )
  // With nothing recorded, every balance below would be measured from zero. The
  // flows are still real, so they stay; the balance line goes, rather than
  // drawing a projection off a starting point nobody ever gave us.
  const anchored = hasBalanceAnchor(data)
  // What they hold now, not where the projection starts: mid-month those are
  // deliberately different, and only one of them is a balance.
  const balance = balanceToday(data)
  const recorded = totalBalance(data)
  const settledMonths = summary.filter((p) => p.actual).length
  const thisMonth = forecast[0]
  // Whole numbers at a glance; cents live in the planner where precision matters.
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, { round: true, ...opts })

  // The same "net result" the plan and the money date report: what a month
  // gains or loses, with money committed to future bills already spoken for.
  const avgNet = forecast.reduce((s, f) => s + f.netResult, 0) / forecast.length
  const lowest = forecast.reduce((min, f) => (f.balance < min.balance ? f : min), forecast[0])
  const savingsRate =
    thisMonth && thisMonth.income > 0
      ? Math.round((thisMonth.net / thisMonth.income) * 100)
      : 0

  const empty = data.accounts.length === 0 && data.recurring.length === 0

  async function restore(file: File) {
    try {
      setData(await importData(file))
    } catch {
      /* invalid file — the Settings restore flow reports errors in detail */
    }
  }

  if (empty) {
    return (
      <div className="max-w-lg mx-auto text-center pt-8 animate-fade-up">
        <Logo className="w-16 h-16 mx-auto rounded-2xl shadow-lift mb-6" />
        <h2 className="text-3xl mb-2">Welcome to CasaresSan Finances</h2>
        <p className="text-muted mb-8">
          Your private, on-device financial advisor. Set up your plan and see your
          cash-flow future in minutes — nothing ever leaves this device.
        </p>
        <div className="space-y-3 text-left">
          <button
            className="card w-full p-4 flex items-center gap-4 hover:shadow-lift transition text-left"
            onClick={() => goTo('plan')}
          >
            <span className="w-10 h-10 rounded-xl bg-forest text-paper grid place-items-center shrink-0">
              <IconPlan width={20} height={20} />
            </span>
            <span>
              <span className="block font-medium">Build my plan</span>
              <span className="block text-sm text-muted">
                Add balances, income and expenses month by month
              </span>
            </span>
          </button>
          <button
            className="card w-full p-4 flex items-center gap-4 hover:shadow-lift transition text-left"
            onClick={() => fileRef.current?.click()}
          >
            <span className="w-10 h-10 rounded-xl bg-forest-tint text-forest grid place-items-center shrink-0">
              <IconUpload width={20} height={20} />
            </span>
            <span>
              <span className="block font-medium">Restore a backup</span>
              <span className="block text-sm text-muted">
                Load a CasaresSan Finances file from your device or Drive
              </span>
            </span>
          </button>
          <button
            className="w-full text-center text-sm text-muted hover:text-forest transition pt-2"
            onClick={() => setData(demoData())}
          >
            …or explore with sample data first
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) restore(f)
            e.target.value = ''
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {anchored ? (
          <Stat
            label="Total balance"
            value={fx(balance)}
            sub={
              Math.abs(balance - recorded) > 0.5
                ? `rolled forward from ${fx(recorded)}`
                : `${data.accounts.length} ${data.accounts.length === 1 ? 'account' : 'accounts'}`
            }
          />
        ) : (
          <button className="card p-5 text-left hover:shadow-lift transition" onClick={() => goTo('plan')}>
            <div className="label">Total balance</div>
            <div className="stat-value text-muted">—</div>
            <div className="mt-1 text-sm text-forest">Add an account to see it</div>
          </button>
        )}
        <Stat
          label="This month net"
          value={fx(thisMonth?.netResult ?? 0, { signed: true })}
          tone={(thisMonth?.netResult ?? 0) >= 0 ? 'good' : 'warn'}
          sub={
            (thisMonth?.setAside ?? 0) > 0.5
              ? `${fx(thisMonth?.income ?? 0)} in · ${fx(thisMonth?.expenses ?? 0)} out · ${fx(thisMonth?.setAside ?? 0)} aside`
              : `${fx(thisMonth?.income ?? 0)} in · ${fx(thisMonth?.expenses ?? 0)} out`
          }
        />
        <Stat
          label="Avg monthly net"
          value={fx(avgNet, { signed: true })}
          tone={avgNet >= 0 ? 'good' : 'warn'}
          sub={`next ${forecast.length} months`}
        />
        <Stat
          label="Savings rate"
          value={`${savingsRate}%`}
          tone={savingsRate >= 0 ? 'good' : 'warn'}
          sub="of income kept, set aside included"
        />
      </div>

      <div className="card p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h2 className="text-xl">Cash-flow forecast</h2>
            <p className="text-sm text-muted">
              {settledMonths > 0
                ? `The last ${settledMonths} ${settledMonths === 1 ? 'month' : 'months'} against what you planned, then the next ${SUMMARY_FORWARD} as planned today`
                : `Income, fixed vs variable expenses · next ${SUMMARY_FORWARD} months`}
              {!anchored && ' · no balance recorded to project from'}
            </p>
          </div>
          {anchored && lowest && lowest.balance < balance && (
            <div className="text-right">
              <div className="label">Projected low</div>
              <div
                className={classNames(
                  'font-serif text-lg',
                  lowest.balance < 0 ? 'text-clay' : 'text-ink',
                )}
              >
                {fx(lowest.balance)}
              </div>
              <div className="text-xs text-muted">{formatMonthLabel(lowest.month, locale)}</div>
            </div>
          )}
        </div>
        <ScenarioBar />
        <CashFlowChart
          points={summary}
          currency={currency}
          locale={locale}
          scenario={scenarioOverlay}
          showBalance={anchored}
        />
      </div>

      {history.length > 0 && (
        <div className="card p-6">
          <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
            <div>
              <h2 className="text-xl">Projected vs actual</h2>
              <p className="text-sm text-muted">
                Your real cash flow against the plan · {history.length}{' '}
                {history.length === 1 ? 'month' : 'months'} of money dates
              </p>
            </div>
            {(() => {
              const last = history[history.length - 1]
              const diff = last.cumulativeActual - last.cumulativePlanned
              return (
                <div className="text-right">
                  <div className="label">Net so far vs plan</div>
                  <div
                    className={classNames(
                      'font-serif text-lg',
                      diff >= 0 ? 'text-forest' : 'text-clay',
                    )}
                  >
                    {fx(diff, { signed: true })}
                  </div>
                  <div className="text-xs text-muted">
                    {fx(last.cumulativeActual)} actual · {fx(last.cumulativePlanned)} planned
                  </div>
                </div>
              )
            })()}
          </div>
          <HistoryChart points={history} currency={currency} locale={locale} />
          <div className="mt-2 flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-forest" /> Actual net (bar)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0 border-t-2 border-dashed border-gold" /> Planned net
            </span>
          </div>
        </div>
      )}

      {yearSankey.nodes.length > 0 && (
        <button className="card p-6 w-full text-left hover:shadow-lift transition" onClick={() => setSankeyOpen(true)}>
          <h2 className="text-xl mb-1">Where your money goes</h2>
          <p className="text-sm text-muted mb-4">
            Full year consolidated · {year} · {yearMonths.length}{' '}
            {yearMonths.length === 1 ? 'month' : 'months'} of money dates · tap for details
          </p>
          <SankeyChart graph={yearSankey} currency={currency} locale={locale} />
        </button>
      )}
      {sankeyOpen && (
        <SankeyOverlay
          graph={yearSankey}
          currency={currency}
          locale={locale}
          title="Where your money goes"
          subtitle={`Full year consolidated · ${year} · ${yearMonths.length} ${yearMonths.length === 1 ? 'month' : 'months'} of money dates`}
          insights={yearSankeyInsights}
          onClose={() => setSankeyOpen(false)}
        />
      )}

      <div className="card overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-xl">The actual numbers</h2>
          <p className="text-sm text-muted">
            Month by month — <span className="text-forest">actual</span> from your money dates,
            then projected
            {!anchored && ' · the last column runs from zero, not from a real balance'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-y border-line">
                <th className="px-6 py-2.5 font-medium">Month</th>
                <th className="px-4 py-2.5 font-medium text-right">Income</th>
                <th className="px-4 py-2.5 font-medium text-right">Fixed</th>
                <th className="px-4 py-2.5 font-medium text-right">Variable</th>
                {/* The row-to-row change in the balance beside it — which is
                    the net result plus anything set aside, since that money
                    stays in the accounts. */}
                <th className="px-4 py-2.5 font-medium text-right">Change</th>
                <th className="px-6 py-2.5 font-medium text-right">
                  {anchored ? 'Balance' : 'Running'}
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((f) => {
                const isNow = f.month === forecast[0]?.month
                return (
                  <tr
                    key={f.month}
                    className={classNames(
                      'border-b border-line/60',
                      isNow && 'bg-forest-tint/50',
                      f.actual && !isNow && 'bg-forest-tint/15',
                    )}
                  >
                    <td className="px-6 py-2.5 whitespace-nowrap">
                      {formatMonthLabel(f.month, locale)}
                      {isNow ? (
                        <span className="ml-2 pill bg-forest-tint text-forest">now</span>
                      ) : f.actual ? (
                        <span className="ml-2 pill bg-forest/10 text-forest">actual</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted tabular-nums">{fx(f.income)}</td>
                    <td className="px-4 py-2.5 text-right text-muted tabular-nums">{fx(f.fixedExpenses)}</td>
                    <td className="px-4 py-2.5 text-right text-muted tabular-nums">{fx(f.variableExpenses)}</td>
                    <td
                      className={classNames(
                        'px-4 py-2.5 text-right font-medium tabular-nums',
                        f.net >= 0 ? 'text-forest' : 'text-clay',
                      )}
                    >
                      {fx(f.net, { signed: true })}
                    </td>
                    <td className="px-6 py-2.5 text-right font-medium tabular-nums">{fx(f.balance)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
