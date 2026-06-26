// Formatting + date helpers shared across the app.

export function formatMoney(
  value: number,
  currency = 'USD',
  locale = 'en-US',
  opts: { compact?: boolean; signed?: boolean } = {},
): string {
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
  })
  const out = fmt.format(Math.abs(value))
  if (opts.signed) return `${value < 0 ? '−' : '+'}${out}`
  return value < 0 ? `−${out}` : out
}

export function formatMonthLabel(month: string, locale = 'en-US'): string {
  // month = "YYYY-MM"
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' })
}

export function shortMonth(month: string, locale = 'en-US'): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'short' })
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function currentMonth(): string {
  return monthKey(new Date())
}

/** Returns the YYYY-MM `n` months after the given month (n may be negative). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return monthKey(d)
}

/** Inclusive list of months from `start` spanning `count` entries. */
export function monthRange(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(start, i))
}

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toUpperCase()
}
