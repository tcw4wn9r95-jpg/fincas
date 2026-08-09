import type { SankeyGraph, SankeyNode } from '../lib/sankey'
import { formatMoney } from '../lib/format'

const W = 780
const H = 340
const NODE_W = 10
const GAP = 8
const TOP_PAD = 30
const BOTTOM_PAD = 10

interface Positioned extends SankeyNode {
  x: number
  y: number
  h: number
}

function layout(graph: SankeyGraph): { positioned: Positioned[]; scale: number } {
  const columns = new Map<number, SankeyNode[]>()
  for (const n of graph.nodes) {
    const list = columns.get(n.column) ?? []
    list.push(n)
    columns.set(n.column, list)
  }
  const colIds = Array.from(columns.keys()).sort((a, b) => a - b)
  const plotH = H - TOP_PAD - BOTTOM_PAD

  let scale = Infinity
  for (const c of colIds) {
    const list = columns.get(c)!
    const total = list.reduce((s, n) => s + n.value, 0)
    const gaps = (list.length - 1) * GAP
    if (total > 0) scale = Math.min(scale, (plotH - gaps) / total)
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  const maxCol = colIds[colIds.length - 1] ?? 0
  const positioned: Positioned[] = []
  for (const c of colIds) {
    const list = columns.get(c)!
    const total = list.reduce((s, n) => s + n.value, 0)
    const contentH = total * scale + (list.length - 1) * GAP
    let y = TOP_PAD + (plotH - contentH) / 2
    const x = c === 0 ? 0 : c === maxCol ? W - NODE_W : (W - NODE_W) / 2
    for (const n of list) {
      const h = Math.max(n.value * scale, 1.5)
      positioned.push({ ...n, x, y, h })
      y += h + GAP
    }
  }
  return { positioned, scale }
}

/** A budget flow diagram: income sources → total income → where it went. */
export function SankeyChart({
  graph,
  currency,
  locale,
}: {
  graph: SankeyGraph
  currency: string
  locale: string
}) {
  if (!graph.nodes.length) return null
  const { positioned, scale } = layout(graph)
  const byId = new Map(positioned.map((n) => [n.id, n]))
  const outCursor = new Map(positioned.map((n) => [n.id, n.y]))
  const inCursor = new Map(positioned.map((n) => [n.id, n.y]))
  const maxCol = Math.max(...positioned.map((n) => n.column))
  const fx = (n: number) => formatMoney(n, currency, locale, { round: true })

  const ribbons = graph.links.map((l) => {
    const s = byId.get(l.source)
    const t = byId.get(l.target)
    if (!s || !t) return null
    const h = Math.max(l.value * scale, 0.75)
    const sy0 = outCursor.get(l.source) ?? s.y
    const sy1 = sy0 + h
    outCursor.set(l.source, sy1)
    const ty0 = inCursor.get(l.target) ?? t.y
    const ty1 = ty0 + h
    inCursor.set(l.target, ty1)
    const x0 = s.x + NODE_W
    const x1 = t.x
    const xm = (x0 + x1) / 2
    const path = `M${x0},${sy0} C${xm},${sy0} ${xm},${ty0} ${x1},${ty0} L${x1},${ty1} C${xm},${ty1} ${xm},${sy1} ${x0},${sy1} Z`
    return {
      key: `${l.source}->${l.target}`,
      path,
      color: l.color,
      title: `${s.label} → ${t.label}: ${fx(l.value)}`,
    }
  })

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Where your money came from and where it went"
    >
      <text x={0} y={14} fontSize={11} letterSpacing={0.4} fill="#6b7670">
        MONEY IN
      </text>
      <text x={W} y={14} fontSize={11} letterSpacing={0.4} fill="#6b7670" textAnchor="end">
        MONEY OUT
      </text>
      <g>
        {ribbons.map(
          (r) => r && <path key={r.key} d={r.path} fill={r.color} stroke="none">
            <title>{r.title}</title>
          </path>,
        )}
      </g>
      <g>
        {positioned.map((n) => {
          const midY = n.y + n.h / 2
          const isLeft = n.column === 0
          const isRight = n.column === maxCol
          const label = `${n.label} · ${fx(n.value)}`
          return (
            <g key={n.id}>
              <rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={2.5} fill={n.color} />
              <title>{label}</title>
              {isLeft && (
                <text x={n.x + NODE_W + 8} y={midY} dy="0.32em" fontSize={11} fill="#1c2521">
                  {label}
                </text>
              )}
              {isRight && (
                <text
                  x={n.x - 8}
                  y={midY}
                  dy="0.32em"
                  fontSize={11}
                  fill="#1c2521"
                  textAnchor="end"
                >
                  {label}
                </text>
              )}
              {!isLeft && !isRight && (
                <text
                  x={n.x + NODE_W / 2}
                  y={Math.max(12, n.y - 10)}
                  fontSize={11}
                  fill="#1c2521"
                  textAnchor="middle"
                >
                  {label}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
