import type { MonthCoverage } from '../lib/coverage'

/**
 * Whether the month on screen is final. Said plainly above its figures, since
 * a month waiting on a statement reads exactly like a bad month otherwise —
 * September showed €550 of income because its salary hadn't been imported.
 */
export function MonthStatus({ coverage }: { coverage: MonthCoverage }) {
  if (coverage.state !== 'provisional') return null
  const names = coverage.missing.map((m) => m.name)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return (
    <div className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-sm">
      <span className="font-medium">Provisional — waiting for {list}.</span>{' '}
      <span className="text-muted">
        {coverage.missing
          .map((m) => (m.through ? `${m.name} is imported through ${m.through}` : `${m.name} has nothing yet`))
          .join('; ')}
        . Until it is in, this month's figures are missing whatever that account carries, and it is left out of
        your averages.
      </span>
    </div>
  )
}
