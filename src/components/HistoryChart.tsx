import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import type { HistoryPoint } from '../lib/forecast'
import { formatMoney } from '../lib/format'

const COLOR = {
  pos: '#2e5347', // actual net, positive
  neg: '#b95f38', // actual net, negative
  planned: '#b8862f', // planned net — a distinct hue for CVD separation
}

function HistoryTooltip({
  active,
  payload,
  currency,
  locale,
}: TooltipProps<number, string> & { currency: string; locale: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as HistoryPoint
  const fx = (n: number) => formatMoney(n, currency, locale, { signed: true })
  const variance = p.actualNet - p.plannedNet
  return (
    <div className="rounded-lg border border-line bg-paper shadow-lift px-3 py-2 text-xs">
      <div className="font-medium text-ink mb-1">{p.label}</div>
      <Row label="Actual net" value={fx(p.actualNet)} color={p.actualNet >= 0 ? COLOR.pos : COLOR.neg} />
      <Row label="Planned net" value={fx(p.plannedNet)} color={COLOR.planned} />
      <div className="mt-1 pt-1 border-t border-line/70">
        <Row
          label={variance >= 0 ? 'Ahead of plan' : 'Behind plan'}
          value={fx(variance)}
          strong
        />
      </div>
    </div>
  )
}

function Row({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted">
        {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className={strong ? 'font-medium text-ink tabular-nums' : 'text-ink tabular-nums'}>{value}</span>
    </div>
  )
}

export function HistoryChart({
  points,
  currency,
  locale,
}: {
  points: HistoryPoint[]
  currency: string
  locale: string
}) {
  const fxc = (n: number) => formatMoney(n, currency, locale, { compact: true })
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={points} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#e6e0d4" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} dy={6} />
        <YAxis tickFormatter={fxc} tickLine={false} axisLine={false} width={52} />
        <Tooltip
          cursor={{ fill: 'rgba(31,61,52,0.06)' }}
          content={<HistoryTooltip currency={currency} locale={locale} />}
        />
        <ReferenceLine y={0} stroke="#c9bfa8" />
        <Bar dataKey="actualNet" name="Actual net" radius={[3, 3, 0, 0]} maxBarSize={34}>
          {points.map((p) => (
            <Cell key={p.month} fill={p.actualNet >= 0 ? COLOR.pos : COLOR.neg} />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="plannedNet"
          name="Planned net"
          stroke={COLOR.planned}
          strokeWidth={2.5}
          strokeDasharray="5 4"
          dot={{ r: 3, fill: COLOR.planned }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
