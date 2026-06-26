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
  Cell,
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
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={points} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1f3d34" />
            <stop offset="100%" stopColor="#6fae93" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e6e0d4" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} dy={6} />
        <YAxis
          tickFormatter={fxc}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          cursor={{ fill: 'rgba(31,61,52,0.05)' }}
          formatter={(value: number, name) => [
            formatMoney(value, currency, locale),
            name,
          ]}
          labelFormatter={(label, payload) => {
            const m = payload?.[0]?.payload?.month
            return m ? formatMonthLabel(m, locale) : label
          }}
        />
        <ReferenceLine y={0} stroke="#cdbf9f" />
        <Bar dataKey="net" name="Net" radius={[4, 4, 0, 0]} barSize={18}>
          {points.map((p, i) => (
            <Cell key={i} fill={p.net >= 0 ? '#9ccdb4' : '#e0a487'} />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="balance"
          name="Balance"
          stroke="url(#balanceLine)"
          strokeWidth={3}
          dot={{ r: 3, fill: '#1f3d34' }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
