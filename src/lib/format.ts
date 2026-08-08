// Formatting + date helpers shared across the app.

export function formatMoney(
  value: number,
  currency = 'USD',
  locale = 'en-US',
  opts: { compact?: boolean; signed?: boolean; round?: boolean } = {},
): string {
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.compact ? 1 : opts.round ? 0 : 2,
    minimumFractionDigits: opts.compact || opts.round ? 0 : 2,
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

/** Normalised transaction description for exact-match grouping (case/space-insensitive). */
export function normDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Parse a money amount typed by a human, accepting either a comma or a dot as
 * the decimal separator (a euro/es-ES keyboard produces a comma). Returns NaN
 * for blank/garbage so callers can decide the fallback.
 */
export function parseAmount(input: string | number): number {
  if (typeof input === 'number') return input
  let v = String(input ?? '').trim().replace(/[^0-9.,-]/g, '')
  if (!v) return NaN
  const hasDot = v.includes('.')
  const hasComma = v.includes(',')
  if (hasDot && hasComma) {
    // Whichever separator comes last is the decimal one.
    if (v.lastIndexOf(',') > v.lastIndexOf('.')) v = v.replace(/\./g, '').replace(',', '.')
    else v = v.replace(/,/g, '')
  } else if (hasComma) {
    const parts = v.split(',')
    // "1,50" → decimal; "1,500" → thousands separator.
    v = parts.length === 2 && parts[1].length <= 2 ? parts[0] + '.' + parts[1] : v.replace(/,/g, '')
  }
  const n = parseFloat(v)
  return Number.isNaN(n) ? NaN : n
}
