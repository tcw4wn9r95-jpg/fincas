import { useMemo, useState } from 'react'
import { useData } from '../store'
import { deriveInsights } from '../lib/insights'
import { streamInsights, hasApiKey } from '../lib/claude'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'
import { Sparkline } from './Sparkline'
import { Markdown } from './Markdown'
import { IconInsights, IconLock, IconCheck } from './icons'

export function Insights({ goToSettings }: { goToSettings: () => void }) {
  const { data } = useData()
  const { currency, locale } = data.settings
  const insights = useMemo(() => deriveInsights(data), [data])
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, { round: true, ...opts })

  const [ai, setAi] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const keyed = hasApiKey(data)

  function runAi() {
    setAiBusy(true)
    setAi('')
    setAiError('')
    let acc = ''
    streamInsights(data, {
      onText: (d) => {
        acc += d
        setAi(acc)
      },
      onDone: (full) => {
        setAi(full || acc)
        setAiBusy(false)
      },
      onError: (msg) => {
        setAiError(msg)
        setAiBusy(false)
      },
    })
  }

  if (!insights) {
    return (
      <div className="max-w-lg mx-auto text-center pt-10 animate-fade-up">
        <IconInsights className="w-12 h-12 mx-auto text-forest mb-4" />
        <h2 className="text-2xl mb-2">Insights</h2>
        <p className="text-muted">
          Once you've done a money date or two, this is where trends and recommendations from your
          real spending will appear.
        </p>
      </div>
    )
  }

  const {
    months,
    savingsRate,
    savingsTrend,
    avgSpend,
    avgNet,
    topCategories,
    rising,
    falling,
    biggestMover,
    overPlan,
    investment,
  } = insights
  const rangeLabel = `${formatMonthLabel(months[0] + '-01', locale)} – ${formatMonthLabel(
    months[months.length - 1] + '-01',
    locale,
  )}`

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h2 className="text-2xl">Insights</h2>
        <p className="text-muted">
          Patterns from your money dates · {months.length} {months.length === 1 ? 'month' : 'months'} ·{' '}
          {rangeLabel}
        </p>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="label">Savings rate</div>
          <div className={classNames('stat-value', savingsRate >= 0 ? 'text-forest' : 'text-clay')}>
            {Math.round(savingsRate * 100)}%
          </div>
          <div className="text-sm text-muted mt-1">
            {savingsTrend > 0 ? 'improving' : savingsTrend < 0 ? 'slipping' : 'steady'} · avg net{' '}
            {fx(avgNet, { signed: true })}
          </div>
        </div>
        <div className="card p-5">
          <div className="label">Avg monthly spend</div>
          <div className="stat-value">{fx(avgSpend)}</div>
          <div className="text-sm text-muted mt-1">across all categories</div>
        </div>
        {biggestMover && (
          <div className="card p-5 col-span-2 lg:col-span-1">
            <div className="label">Biggest recent move</div>
            <div className={classNames('stat-value', biggestMover.delta > 0 ? 'text-clay' : 'text-forest')}>
              {biggestMover.delta > 0 ? '▲' : '▼'} {biggestMover.category}
            </div>
            <div className="text-sm text-muted mt-1">
              {fx(biggestMover.prev)} → {fx(biggestMover.current)}
            </div>
          </div>
        )}
      </div>

      {/* Trends */}
      {(rising.length > 0 || falling.length > 0) && (
        <div className="card p-6">
          <h3 className="text-lg mb-1">Trends</h3>
          <p className="text-sm text-muted mb-4">Categories moving in one direction, month after month</p>
          <div className="space-y-2.5">
            {rising.map((c) => (
              <TrendRow key={c.category} c={c} up fx={fx} />
            ))}
            {falling.map((c) => (
              <TrendRow key={c.category} c={c} up={false} fx={fx} />
            ))}
          </div>
        </div>
      )}

      {/* Top categories */}
      {topCategories.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg mb-1">Where your money goes</h3>
          <p className="text-sm text-muted mb-4">Average monthly spend by category</p>
          <div className="space-y-2.5">
            {topCategories.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="text-sm text-ink w-28 truncate">{c.category}</span>
                <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
                  <div className="h-full bg-forest/40 rounded-full" style={{ width: `${Math.round(c.share * 100)}%` }} />
                </div>
                <span className="text-sm tabular-nums text-ink w-20 text-right">{fx(c.avg)}</span>
                <span className="text-xs tabular-nums text-muted w-9 text-right">{Math.round(c.share * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Watch-outs */}
      {overPlan.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg mb-1">Consistently over plan</h3>
          <p className="text-sm text-muted mb-4">Where actual spend keeps beating the budget</p>
          <div className="space-y-2">
            {overPlan.map((c) => (
              <div key={c.category} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="pill bg-clay/10 text-clay">{c.category}</span>
                  <span className="text-muted">
                    over in {c.monthsOver} of {c.totalMonths} months
                  </span>
                </span>
                <span className="tabular-nums text-ink">
                  {fx(c.avgActual)} <span className="text-muted">vs {fx(c.avgPlanned)} planned</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Investment strategies */}
      <div className="card p-6">
        <h3 className="text-lg mb-1">Before you invest</h3>
        <p className="text-sm text-muted mb-4">
          Standard checkpoints from common personal-finance guidance, built from your own numbers —
          not personalized advice.
        </p>
        <div className="space-y-2.5 mb-5">
          <ChecklistRow
            ok={investment.monthsCovered !== null && investment.monthsCovered >= investment.emergencyFundLow}
            label={
              investment.monthsCovered === null
                ? 'Emergency fund — needs a recorded balance and some spending history to estimate'
                : `Emergency fund: ${investment.monthsCovered} ${investment.monthsCovered === 1 ? 'month' : 'months'} of expenses saved (aim for ${investment.emergencyFundLow}–${investment.emergencyFundHigh})`
            }
          />
          <ChecklistRow
            ok={investment.savingsRate >= investment.savingsRateBenchmark}
            label={`Savings rate: ${Math.round(investment.savingsRate * 100)}% (aim for ~${Math.round(investment.savingsRateBenchmark * 100)}%, the "save" slice of the 50/30/20 guideline)`}
          />
        </div>
        {investment.debtPlanLines > 0 && (
          <div className="rounded-lg bg-gold/5 border border-gold/40 px-4 py-3 text-sm text-ink mb-5">
            {investment.debtPlanLines} loan payment{investment.debtPlanLines === 1 ? '' : 's'} in your plan.
            Paying off high-interest debt usually beats what investing returns, so weigh payoff against
            investing before committing new cash to the market.
          </div>
        )}
        <h4 className="text-sm font-medium text-ink mb-2">General principles</h4>
        <ul className="space-y-1.5 text-sm text-muted mb-4 list-disc ml-5">
          <li>Capture any employer retirement match first — it's an immediate, guaranteed return.</li>
          <li>Prioritize paying off high-interest debt (credit cards, etc.) before investing new cash.</li>
          <li>Favor low-cost, diversified index funds over picking individual stocks.</li>
          <li>Invest on a regular schedule (dollar-cost averaging) rather than trying to time the market.</li>
          <li>Match your risk level to your time horizon — a longer horizon can carry more in equities.</li>
        </ul>
        <p className="text-xs text-muted">
          This is general, educational information, not personalized investment advice. Consider a
          licensed financial advisor for your specific situation.
        </p>
      </div>

      {/* AI recommendations */}
      <div className="card p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div>
            <h3 className="text-lg">Recommendations</h3>
            <p className="text-sm text-muted">Tailored advice from Claude, grounded in your numbers</p>
          </div>
          {keyed && (
            <button className="btn-primary shrink-0" onClick={runAi} disabled={aiBusy}>
              <IconInsights width={16} height={16} /> {aiBusy ? 'Thinking…' : ai ? 'Refresh' : 'Get recommendations'}
            </button>
          )}
        </div>
        {!keyed ? (
          <div className="rounded-lg bg-gold/5 border border-gold/40 px-4 py-3 flex items-center gap-3 text-sm">
            <IconLock className="text-gold shrink-0" />
            <span className="flex-1">Add your Anthropic API key to get tailored recommendations.</span>
            <button className="btn-ghost shrink-0" onClick={goToSettings}>
              Open Settings
            </button>
          </div>
        ) : aiError ? (
          <div className="rounded-lg bg-clay/10 border border-clay/30 px-4 py-3 text-sm text-clay">{aiError}</div>
        ) : ai ? (
          <div className="mt-2 text-sm text-ink">
            <Markdown text={ai} />
            {aiBusy && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-sage animate-pulse" />}
          </div>
        ) : (
          <p className="text-sm text-muted mt-2">
            Press <span className="text-ink">Get recommendations</span> for a short, specific briefing on where
            to adjust.
          </p>
        )}
      </div>
    </div>
  )
}

function ChecklistRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className={classNames('mt-0.5 shrink-0', ok ? 'text-forest' : 'text-gold')}>
        {ok ? (
          <IconCheck width={15} height={15} />
        ) : (
          <span className="block w-[13px] h-[13px] rounded-full border-2 border-gold" />
        )}
      </span>
      <span className="text-ink leading-relaxed">{label}</span>
    </div>
  )
}

function TrendRow({
  c,
  up,
  fx,
}: {
  c: { category: string; run: number; from: number; to: number; vals: number[] }
  up: boolean
  fx: (n: number) => string
}) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <span className={classNames('text-sm', up ? 'text-clay' : 'text-forest')}>{up ? '▲' : '▼'}</span>
      <span className="text-sm text-ink flex-1 min-w-0">
        <span className="font-medium">{c.category}</span> {up ? 'up' : 'down'} {c.run} months in a row
      </span>
      <Sparkline values={c.vals} color={up ? '#b95f38' : '#2e5347'} />
      <span className="text-sm tabular-nums text-muted w-28 text-right">
        {fx(c.from)} → {fx(c.to)}
      </span>
    </div>
  )
}
