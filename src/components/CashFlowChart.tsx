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
  Legend,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { ForecastPoint } from '../lib/types'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'

interface Props {
  points: ForecastPoint[]
  currency: string
  locale: string
  /** Optional what-if overlay: a second balance line drawn against the baseline. */
  scenario?: { name: string; points: ForecastPoint[] }
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
}

type ChartPoint = ForecastPoint & { scenarioBalance?: number }

function SubtotalTooltip({
  active,
  payload,
  currency,
  locale,
  scenarioName,
}: TooltipProps<number, string> & { currency: string; locale: string; scenarioName?: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as ChartPoint
  const fx = (n: number) => formatMoney(n, currency, locale)

  const rows: Array<{ label: string; value: number; color?: string; strong?: boolean; top?: boolean }> = [
    { label: 'Income', value: p.income, color: COLOR.income },
    { label: 'Fixed expenses', value: -p.fixedExpenses, color: COLOR.fixed },
    { label: 'Variable expenses', value: -p.variableExpenses, color: COLOR.variable },
    { label: 'Total expenses', value: -p.expenses, strong: true, top: true },
    { label: 'Net', value: p.net, strong: true },
    { label: 'End balance', value: p.balance, color: COLOR.balance, strong: true, top: true },
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
        {p.projected && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">projected</span>}
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

export function CashFlowChart({ points, currency, locale, scenario }: Props) {
  const fxc = (n: number) => formatMoney(n, currency, locale, { compact: true })

  // Merge the scenario's balance onto each month so it draws as one series.
  const data: ChartPoint[] = points.map((p, i) => ({
    ...p,
    scenarioBalance: scenario?.points[i]?.balance,
  }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#e6e0d4" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} dy={6} />
        <YAxis tickFormatter={fxc} tickLine={false} axisLine={false} width={52} />
        <Tooltip
          cursor={{ fill: 'rgba(31,61,52,0.06)' }}
          content={<SubtotalTooltip currency={currency} locale={locale} scenarioName={scenario?.name} />}
        />
        <Legend
          verticalAlign="top"
          iconType="circle"
          wrapperStyle={{ fontSize: 12, paddingBottom: 10 }}
        />
        <ReferenceLine y={0} stroke="#cdbf9f" />
        {/* Stacked expense subtotals — 2px surface stroke keeps segments separable */}
        <Bar
          dataKey="fixedExpenses"
          stackId="exp"
          fill={COLOR.fixed}
          stroke="#fbf9f4"
          strokeWidth={2}
          name="Fixed expenses"
          barSize={20}
        />
        <Bar
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
          type="monotone"
          dataKey="income"
          name="Income"
          stroke={COLOR.income}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="balance"
          name={scenario ? 'Balance · baseline' : 'Projected balance'}
          stroke={COLOR.balance}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: COLOR.balance, stroke: '#fbf9f4', strokeWidth: 2 }}
        />
        {scenario && (
          <Line
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
  )
}
