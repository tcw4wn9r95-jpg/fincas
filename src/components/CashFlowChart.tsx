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
import type { ForecastPoint } from '../lib/types'
import { formatMoney, formatMonthLabel } from '../lib/format'

interface Props {
  points: ForecastPoint[]
  currency: string
  locale: string
}

export function CashFlowChart({ points, currency, locale }: Props) {
  const fxc = (n: number) => formatMoney(n, currency, locale, { compact: true })

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={points} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1f3d34" />
            <stop offset="100%" stopColor="#6fae93" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e6e0d4" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} dy={6} />
        <YAxis tickFormatter={fxc} tickLine={false} axisLine={false} width={52} />
        <Tooltip
          cursor={{ fill: 'rgba(31,61,52,0.05)' }}
          formatter={(value: number) => formatMoney(value, currency, locale)}
          labelFormatter={(label, payload) => {
            const m = payload?.[0]?.payload?.month
            return m ? formatMonthLabel(m, locale) : label
          }}
        />
        <Legend verticalAlign="top" height={30} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={0} stroke="#cdbf9f" />
        {/* Stacked expense subtotals: fixed (bottom) + variable (top) = total spend */}
        <Bar dataKey="fixedExpenses" stackId="exp" fill="#2e5347" name="Fixed expenses" barSize={20} />
        <Bar
          dataKey="variableExpenses"
          stackId="exp"
          fill="#d59a78"
          name="Variable expenses"
          barSize={20}
          radius={[4, 4, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="income"
          name="Income"
          stroke="#6fae93"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="balance"
          name="Projected balance"
          stroke="url(#balanceLine)"
          strokeWidth={3}
          dot={{ r: 3, fill: '#1f3d34' }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
