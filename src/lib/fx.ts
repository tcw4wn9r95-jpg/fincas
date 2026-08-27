// Spending in another currency.
//
// A spend logged abroad is two facts: what the card was charged in dollars, and
// what that is worth in the currency everything else in this app is counted in.
// Only the second is stored on `Transaction.amount` — every figure in the app
// reads that field, and a budget that sometimes holds dollars would be wrong
// everywhere at once. The original is kept beside it, because it is the number
// on the receipt in your pocket and the number the statement may well post.

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The currencies the European Central Bank publishes a daily reference rate
 * for, which is what "the official rate" means here. Deliberately a short list
 * of the ones anyone is likely to hand over a card in, rather than all thirty:
 * a picker you have to scroll is worse than one that occasionally sends you to
 * type the rate yourself.
 */
export const FX_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK',
  'PLN', 'CZK', 'BRL', 'MXN', 'INR', 'ZAR', 'TRY', 'SGD', 'HKD', 'NZD',
] as const

export interface ForeignAmount {
  /** What the card was actually charged, positive. */
  amount: number
  currency: string
  /** Units of the account's currency per unit of `currency`. */
  rate: number
  /**
   * The day the rate is published for. Not always the day you spent: the ECB
   * publishes on working days only, so a Saturday's spending is converted at
   * Friday's rate, and saying which day was used is the difference between a
   * figure you can check and one you have to trust.
   */
  rateDate: string
  /** True when the rate was typed in rather than fetched. */
  manual?: boolean
}

export interface SpotRate {
  rate: number
  date: string
}

const CACHE_KEY = 'fincas.fx.v1'
const HOST = 'https://api.frankfurter.dev/v1'

type Cache = Record<string, SpotRate>

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache
  } catch {
    return {}
  }
}

function writeCache(cache: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // A full or unavailable store costs a re-fetch, nothing more.
  }
}

const cacheKey = (from: string, to: string, date: string) => `${from}:${to}:${date}`

/**
 * The official rate for a day, from the European Central Bank's daily reference
 * rates via Frankfurter. Cached in the browser and never re-fetched for a past
 * date, because a published reference rate does not change.
 *
 * Returns `null` rather than throwing when it can't be had — offline, or a day
 * with no publication yet — and the caller offers to take the rate by hand. The
 * request carries a date and two currency codes and nothing else: no amount, no
 * description, nothing that says anything about your money.
 */
export async function spotRate(from: string, to: string, onDate: string): Promise<SpotRate | null> {
  if (from === to) return { rate: 1, date: onDate }
  const cache = readCache()
  const key = cacheKey(from, to, onDate)
  const hit = cache[key]
  if (hit) return hit

  const fetchAt = async (path: string): Promise<SpotRate | null> => {
    try {
      // Bounded, because the failure that matters is not an error but a hang:
      // an unanswered request left the rate "looking up" for ever and the Log
      // button disabled with it, which is a worse outcome than no rate at all.
      // Six seconds, then the caller is offered the field to type it himself.
      const res = await fetch(`${HOST}/${path}?base=${from}&symbols=${to}`, {
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) return null
      const body = (await res.json()) as { date?: string; rates?: Record<string, number> }
      const rate = body.rates?.[to]
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
      return { rate, date: body.date ?? onDate }
    } catch {
      return null
    }
  }

  // Today's rate is published in the afternoon, and a date in the future has no
  // rate at all — in both cases the most recent published one is the honest
  // answer, and it comes back stamped with the day it belongs to.
  const found = (await fetchAt(onDate)) ?? (await fetchAt('latest'))
  if (!found) return null
  cache[key] = found
  // The day the rate actually belongs to, so Saturday and Sunday both resolve
  // from one stored Friday.
  cache[cacheKey(from, to, found.date)] = found
  writeCache(cache)
  return found
}

/** What a foreign amount comes to in the account's currency. */
export function convert(amount: number, rate: number): number {
  return round2(amount * rate)
}

/**
 * Whether a statement line is plausibly the same spend as one logged by hand in
 * another currency.
 *
 * Two ways it can be. The statement may post the original amount, when the card
 * itself is held in that currency. Or it posts the converted charge — but at
 * the bank's rate and with its fee, never at the ECB's reference rate, so the
 * figures differ by a percent or two and demanding equality would find nothing.
 * The date is given room for the same reason: a foreign charge settles a day or
 * two after it is made.
 *
 * Only ever consulted for a line that carries a foreign amount. An ordinary
 * spend keeps the exact match, because loosening that would start pairing
 * genuinely separate purchases.
 */
export function foreignLineMatches(
  logged: { date: string; amount: number; foreign?: ForeignAmount },
  row: { date: string; amount: number },
): boolean {
  const f = logged.foreign
  if (!f) return false
  if (Math.abs(daysApart(logged.date, row.date)) > 3) return false
  const charged = Math.abs(row.amount)
  // Posted in the currency it was spent in.
  if (Math.abs(charged - Math.abs(f.amount)) < 0.005) return true
  // Posted converted, at whatever rate and fee the bank applied.
  const expected = Math.abs(logged.amount)
  return Math.abs(charged - expected) <= Math.max(1, expected * 0.03)
}

function daysApart(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/** "$50.00 at 0.8645" — the receipt, for a row whose amount has been converted. */
export function describeForeign(f: ForeignAmount, locale = 'en-GB'): string {
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: f.currency,
    maximumFractionDigits: 2,
  }).format(f.amount)
  return `${amount} at ${f.rate.toFixed(4)}`
}
