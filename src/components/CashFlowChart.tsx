import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { ForecastPoint } from '../lib/types'
import type { SummaryPoint } from '../lib/forecast'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'

interface Props {
  /**
   * Settled months first, then projected ones — see `buildSummary`. A plain
   * forecast (all projected) is fine too; the settled half simply stays empty.
   */
  points: SummaryPoint[]
  currency: string
  locale: string
  /** Optional what-if overlay: a second balance line drawn against the baseline. */
  scenario?: { name: string; points: ForecastPoint[] }
  /**
   * Off when no account records a balance: the flows are still real, but a
   * balance line would be projected from zero and read as fact.
   */
  showBalance?: boolean
}

// Series colors validated against the paper surface (#fbf9f4):
// contrast ≥ 3:1 and CVD-safe adjacency (protan ΔE 21+).
//
// One hue per direction of money: green in, clay out. What was planned uses the
// same hue as what happened, dotted — so a dotted green line reads as "the
// income you expected" without a colour to learn.
const COLOR = {
  income: '#3f7d63',
  expenses: '#b95f38',
  balance: '#1f3d34',
  // Violet reads as "hypothetical" and sits in a different hue family from the
  // greens/clay, so it stays separable under colour-vision deficiency.
  scenario: '#6d5296',
}

type ChartPoint = SummaryPoint & { scenarioBalance?: number }

/**
 * Axis bounds that are guaranteed to contain the data.
 *
 * Two Y axes make recharts align their tick counts, and its automatic rounding
 * can land the top of one below its own maximum — which silently clips the end
 * of the balance line off the top of the plot rather than showing a taller
 * axis. Rounding out to a half-decade step ourselves can only ever widen.
 */
const niceStep = (v: number) => {
  const step = Math.pow(10, Math.floor(Math.log10(v))) / 2
  return Math.ceil(v / step) * step
}
/** The month before this one, for spotting a break in a run of settled months. */
const prevMonth = (m: string) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(y, mm - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const axisMin = (min: number) => (min >= 0 ? 0 : -niceStep(-min))
const axisMax = (max: number) => (max <= 0 ? 0 : niceStep(max))

function SubtotalTooltip({
  active,
  payload,
  currency,
  locale,
  scenarioName,
  showBalance = true,
}: TooltipProps<number, string> & {
  currency: string
  locale: string
  scenarioName?: string
  showBalance?: boolean
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as ChartPoint
  const fx = (n: number) => formatMoney(n, currency, locale)

  // A settled month carries what the plan said as well, so the two can be read
  // off against each other without leaving the tooltip.
  const planned = typeof p.plannedIncome === 'number'
  const rows: Array<{ label: string; value: number; color?: string; strong?: boolean; top?: boolean }> = [
    { label: 'Income', value: p.income, color: COLOR.income },
    ...(planned ? [{ label: 'Planned income', value: p.plannedIncome! }] : []),
    { label: 'Expenses', value: -p.expenses, color: COLOR.expenses, top: true },
    ...(planned ? [{ label: 'Planned expenses', value: -(p.plannedExpenses ?? 0) }] : []),
    // The split isn't drawn any more, but it is the first thing you want when a
    // month looks wrong: committed costs or discretionary ones.
    { label: 'of which fixed', value: -p.fixedExpenses },
    { label: 'of which variable', value: -p.variableExpenses },
    ...(p.setAside > 0.5 ? [{ label: 'Set aside', value: -p.setAside, top: true }] : []),
    // Two different figures, named apart so neither can be read as the other:
    // what the month gained or lost, and what the balance actually did with
    // money that only moved pocket.
    { label: 'Net result', value: p.netResult, strong: true },
    ...(showBalance
      ? [
          ...(p.setAside > 0.5 ? [{ label: 'Change in balance', value: p.net, top: true }] : []),
          {
            label: 'End balance',
            value: p.balance,
            color: COLOR.balance,
            strong: true,
            top: p.setAside <= 0.5,
          },
        ]
      : []),
  ]
  if (typeof p.scenarioBalance === 'number') {
    rows.push({
      label: scenarioName || 'Scenario',
      value: p.scenarioBalance,
      color: COLOR.scenario,
      strong: true,
    })
  }

  return (
    <div className="rounded-xl border border-line bg-paper shadow-lift px-4 py-3 text-sm min-w-[220px]">
      <div className="font-medium text-ink mb-2">
        {formatMonthLabel(p.month, locale)}
        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
          {p.actual ? 'actual' : p.projected ? 'projected' : 'planned'}
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div
            key={r.label}
            className={classNames(
              'flex items-center justify-between gap-6',
              r.top && 'border-t border-line pt-1 mt-1',
            )}
          >
            <span className="flex items-center gap-1.5 text-muted">
              {r.color && (
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: r.color }}
                />
              )}
              {r.label}
            </span>
            <span
              className={classNames(
                'tabular-nums',
                r.strong ? 'font-semibold text-ink' : 'text-ink',
                r.label === 'Net result' && (p.netResult >= 0 ? 'text-forest' : 'text-clay'),
              )}
            >
              {r.value < 0 ? `−${fx(Math.abs(r.value))}` : fx(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CashFlowChart({ points, currency, locale, scenario, showBalance = true }: Props) {
  const fxc = (n: number) => formatMoney(n, currency, locale, { compact: true })

  // Merged by month, not by position: the baseline can start six months before
  // the scenario's own first point.
  const scenarioBalances = new Map(scenario?.points.map((p) => [p.month, p.balance]))
  const data: ChartPoint[] = points.map((p) => ({
    ...p,
    scenarioBalance: scenarioBalances.get(p.month),
  }))

  // The settled stretches, shaded so "what happened" reads apart from "what is
  // planned" without a second chart. One band per unbroken run: a month inside
  // the window that was never imported is the plan again, and shading over it
  // would claim it as history.
  const runs: Array<[string, string]> = []
  for (const p of points) {
    const last = runs[runs.length - 1]
    if (!p.actual) continue
    if (last && last[1] === prevMonth(p.month)) last[1] = p.month
    else runs.push([p.month, p.month])
  }
  const hasPlannedOverlay = runs.length > 0

  // Eighteen months cross a year boundary, so the axis needs one unique key per
  // month; January carries the year to say which one it is.
  const labels = new Map(points.map((p) => [p.month, p.label]))
  const tick = (m: string) =>
    m.slice(5) === '01' ? `${labels.get(m)} ${m.slice(2, 4)}` : labels.get(m) ?? m

  // Eighteen months don't fit a phone: rather than dropping months or crushing
  // them together, the plot keeps a legible width and the narrow screen scrolls
  // it. On a wide one the min-width never binds.
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <div style={{ minWidth: Math.max(320, points.length * 38) }}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#e6e0d4" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={tick}
              tickLine={false}
              axisLine={false}
              dy={6}
              minTickGap={4}
              interval="preserveStartEnd"
            />
            {/* Flows on the left, the balance on its own scale at the right: a
                balance an order of magnitude larger than a month's spending would
                otherwise squash both flow lines onto the axis. */}
            <YAxis
              yAxisId="flow"
              domain={[axisMin, axisMax]}
              tickFormatter={fxc}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <YAxis
              yAxisId="balance"
              orientation="right"
              domain={[axisMin, axisMax]}
              tickFormatter={fxc}
              tickLine={false}
              axisLine={false}
              width={showBalance ? 48 : 0}
              tick={showBalance ? { fill: COLOR.balance } : false}
            />
            <Tooltip
              cursor={{ stroke: '#c9bfa8', strokeWidth: 1 }}
              content={
                <SubtotalTooltip
                  currency={currency}
                  locale={locale}
                  scenarioName={scenario?.name}
                  showBalance={showBalance}
                />
              }
            />
            <Legend
              verticalAlign="top"
              iconType="circle"
              wrapperStyle={{ fontSize: 12, paddingBottom: 10 }}
            />
            <ReferenceLine yAxisId="flow" y={0} stroke="#cdbf9f" />
            {runs.map(([from, to], i) => (
              <ReferenceArea
                key={from}
                yAxisId="flow"
                x1={from}
                x2={to}
                fill="#2e5347"
                fillOpacity={0.05}
                label={
                  i === 0
                    ? {
                        value: 'what happened',
                        position: 'insideTopLeft',
                        fill: '#8a8375',
                        fontSize: 11,
                      }
                    : undefined
                }
              />
            ))}
            <Line
              yAxisId="flow"
              type="linear"
              dataKey="income"
              name="Income"
              stroke={COLOR.income}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: COLOR.income, stroke: '#fbf9f4', strokeWidth: 2 }}
            />
            <Line
              yAxisId="flow"
              type="linear"
              dataKey="expenses"
              name="Expenses"
              stroke={COLOR.expenses}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: COLOR.expenses, stroke: '#fbf9f4', strokeWidth: 2 }}
            />
            {/* Only over the settled months — ahead of today the plan is the line
                already drawn, and a second identical one would say nothing. */}
            {hasPlannedOverlay && (
              <Line
                yAxisId="flow"
                type="linear"
                dataKey="plannedIncome"
                name="Planned income"
                stroke={COLOR.income}
                strokeWidth={1.75}
                strokeDasharray="2 3"
                dot={{ r: 2.5, fill: COLOR.income, strokeWidth: 0 }}
              />
            )}
            {hasPlannedOverlay && (
              <Line
                yAxisId="flow"
                type="linear"
                dataKey="plannedExpenses"
                name="Planned expenses"
                stroke={COLOR.expenses}
                strokeWidth={1.75}
                strokeDasharray="2 3"
                dot={{ r: 2.5, fill: COLOR.expenses, strokeWidth: 0 }}
              />
            )}
            {showBalance && (
              <Line
                yAxisId="balance"
                type="linear"
                dataKey="balance"
                name={scenario ? 'Balance · baseline' : 'Projected balance'}
                stroke={COLOR.balance}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: COLOR.balance, stroke: '#fbf9f4', strokeWidth: 2 }}
              />
            )}
            {showBalance && scenario && (
              <Line
                yAxisId="balance"
                type="linear"
                dataKey="scenarioBalance"
                name={`Balance · ${scenario.name}`}
                stroke={COLOR.scenario}
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 5, fill: COLOR.scenario, stroke: '#fbf9f4', strokeWidth: 2 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
