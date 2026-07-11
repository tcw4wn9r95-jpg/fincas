interface Props {
  values: number[]
  width?: number
  height?: number
  color?: string
}

/** A tiny inline trend line — last point marked. Purely decorative context. */
export function Sparkline({ values, width = 68, height = 22, color = '#2e5347' }: Props) {
  if (values.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2)
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2)
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lastX = x(values.length - 1)
  const lastY = y(values[values.length - 1])
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} />
    </svg>
  )
}
