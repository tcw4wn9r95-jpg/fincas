import {
  ComposedChart,
  Bar,
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
const COLOR = {
  fixed: '#2e5347',
  variable: '#b95f38',
  income: '#3f7d63',
  balance: '#1f3d34',
  // Violet reads as "hypothetical" and sits in a different hue family from the
  // greens/clay, so it stays separable under colour-vision deficiency.
  scenario: '#6d5296',
  // What was planned for a month that has since happened. Gold is already the
  // "planned" hue on the track-record chart, so the two read as one idea.
  plannedIn: '#b8862f',
  plannedOut: '#7d7466',
}

type ChartPoint = SummaryPoint & { scenarioBalance?: number }

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
    ...(planned ? [{ label: 'Planned income', value: p.plannedIncome!, color: COLOR.plannedIn }] : []),
    { label: 'Fixed expenses', value: -p.fixedExpenses, color: COLOR.fixed },
    { label: 'Variable expenses', value: -p.variableExpenses, color: COLOR.variable },
    { label: 'Total expenses', value: -p.expenses, strong: true, top: true },
    ...(planned
      ? [{ label: 'Planned expenses', value: -(p.plannedExpenses ?? 0), color: COLOR.plannedOut }]
      : []),
    ...(p.setAside > 0.5 ? [{ label: 'Set aside', value: -p.setAside }] : []),
    { label: 'Net', value: p.net, strong: true },
    ...(showBalance
      ? [{ label: 'End balance', value: p.balance, color: COLOR.balance, strong: true, top: true }]
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
                r.label === 'Net' && (p.net >= 0 ? 'text-forest' : 'text-clay'),
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

  // The settled stretch, shaded so "what happened" reads apart from "what is
  // planned" without a second chart.
  const settled = points.filter((p) => !p.projected && p.actual)
  const hasPlannedOverlay = settled.length > 0
  const firstSettled = settled[0]?.month
  const lastSettled = settled[settled.length - 1]?.month

  // Eighteen months cross a year boundary, so the axis needs one unique key per
  // month; January carries the year to say which one it is.
  const labels = new Map(points.map((p) => [p.month, p.label]))
  const tick = (m: string) =>
    m.slice(5) === '01' ? `${labels.get(m)} ${m.slice(2, 4)}` : labels.get(m) ?? m

  // Eighteen months don't fit a phone: rather than dropping months or letting
  // the bars collapse into hairlines, the plot keeps a legible width and the
  // narrow screen scrolls it. On a wide one the min-width never binds.
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
                otherwise flatten the bars into a strip along the axis. */}
            <YAxis yAxisId="flow" tickFormatter={fxc} tickLine={false} axisLine={false} width={48} />
            <YAxis
              yAxisId="balance"
              orientation="right"
              tickFormatter={fxc}
              tickLine={false}
              axisLine={false}
              width={showBalance ? 48 : 0}
              tick={showBalance ? { fill: COLOR.balance } : false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(31,61,52,0.06)' }}
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
            {hasPlannedOverlay && (
              <ReferenceArea
                yAxisId="flow"
                x1={firstSettled}
                x2={lastSettled}
                fill="#2e5347"
                fillOpacity={0.05}
                label={{
                  value: 'what happened',
                  position: 'insideTopLeft',
                  fill: '#8a8375',
                  fontSize: 11,
                }}
              />
            )}
            {/* Stacked expense subtotals — 2px surface stroke keeps segments separable */}
            <Bar
              yAxisId="flow"
              dataKey="fixedExpenses"
              stackId="exp"
              fill={COLOR.fixed}
              stroke="#fbf9f4"
              strokeWidth={2}
              name="Fixed expenses"
              barSize={20}
            />
            <Bar
              yAxisId="flow"
              dataKey="variableExpenses"
              stackId="exp"
              fill={COLOR.variable}
              stroke="#fbf9f4"
              strokeWidth={2}
              name="Variable expenses"
              barSize={20}
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="flow"
              type="monotone"
              dataKey="income"
              name="Income"
              stroke={COLOR.income}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
            {/* Only over the settled months — ahead of today the plan is the figure
                already drawn, and a second identical line would say nothing. */}
            {hasPlannedOverlay && (
              <Line
                yAxisId="flow"
                type="monotone"
                dataKey="plannedIncome"
                name="Planned income"
                stroke={COLOR.plannedIn}
                strokeWidth={2}
                strokeDasharray="2 3"
                dot={{ r: 2.5, fill: COLOR.plannedIn, strokeWidth: 0 }}
              />
            )}
            {hasPlannedOverlay && (
              <Line
                yAxisId="flow"
                type="monotone"
                dataKey="plannedExpenses"
                name="Planned expenses"
                stroke={COLOR.plannedOut}
                strokeWidth={2}
                strokeDasharray="2 3"
                dot={{ r: 2.5, fill: COLOR.plannedOut, strokeWidth: 0 }}
              />
            )}
            {showBalance && (
              <Line
                yAxisId="balance"
                type="monotone"
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
                type="monotone"
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
