import { useEffect, useMemo, useState } from 'react'
import { FX_CURRENCIES, convert, spotRate, type ForeignAmount, type SpotRate } from '../lib/fx'
import { formatMoney, parseAmount, classNames } from '../lib/format'

/**
 * The currency half of a "log a spend" box: which currency it was paid in, the
 * official rate for that day, and what it comes to in your own money.
 *
 * The rate is fetched, not guessed, and the day it belongs to is shown — a
 * converted figure you cannot check is just a number someone made up. When it
 * can't be fetched (offline, or a rate not published yet) the field is still
 * usable: type the rate off the receipt and the spend is recorded with it,
 * marked as one you supplied.
 */
export function useForeignRate(currency: string, base: string, date: string) {
  const [fetched, setFetched] = useState<SpotRate | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [typed, setTyped] = useState('')

  const foreign = currency !== base
  useEffect(() => {
    if (!foreign) {
      setFetched(null)
      setFailed(false)
      return
    }
    let alive = true
    setLoading(true)
    setFailed(false)
    spotRate(currency, base, date).then((r) => {
      if (!alive) return
      setLoading(false)
      setFetched(r)
      setFailed(!r)
    })
    return () => {
      alive = false
    }
  }, [foreign, currency, base, date])

  // A typed rate always wins: it came off the receipt, and the whole reason to
  // offer the field is that the published figure was not to be had or not right.
  const typedRate = parseAmount(typed) || 0
  const rate = !foreign ? 1 : typedRate > 0 ? typedRate : (fetched?.rate ?? 0)
  const usable = !foreign || rate > 0

  /** The `foreign` record to store beside a converted amount, if there is one. */
  function record(amount: number): ForeignAmount | undefined {
    if (!foreign || rate <= 0) return undefined
    return {
      amount: Math.abs(amount),
      currency,
      rate,
      rateDate: typedRate > 0 ? date : (fetched?.date ?? date),
      ...(typedRate > 0 ? { manual: true } : {}),
    }
  }

  return {
    foreign,
    rate,
    usable,
    loading,
    failed,
    rateDate: fetched?.date ?? date,
    typedRate: typedRate > 0,
    typed,
    setTyped,
    reset: () => setTyped(''),
    record,
    /** What a foreign amount comes to in the account's currency. */
    convert: (amount: number) => (foreign ? convert(amount, rate) : amount),
  }
}

export function CurrencyPicker({
  value,
  base,
  onChange,
  id,
}: {
  value: string
  base: string
  onChange: (currency: string) => void
  id?: string
}) {
  // Your own currency first — it is the answer almost every time, and a picker
  // that makes you hunt for it taxes the common case to serve the rare one.
  const options = useMemo(() => {
    const rest = FX_CURRENCIES.filter((c) => c !== base)
    return [base, ...rest]
  }, [base])
  return (
    <select
      id={id}
      className="input w-auto"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Currency"
      title="The currency you actually paid in"
    >
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )
}

/** What the conversion came to, and on whose authority. */
export function RateNote({
  fx,
  amount,
  currency,
  base,
  locale,
  date,
}: {
  fx: ReturnType<typeof useForeignRate>
  amount: number
  currency: string
  base: string
  locale: string
  date: string
}) {
  if (!fx.foreign) return null
  const money = (n: number, c: string) => formatMoney(n, c, locale)

  if (fx.loading && !fx.typedRate) {
    return <p className="text-xs text-muted mt-1.5">Looking up the {currency} rate for {date}…</p>
  }

  if (!fx.usable) {
    return (
      <div className="mt-1.5 text-xs">
        <p className="text-clay">
          No published rate for {currency} on {date} — offline, or not out yet. Type the rate from
          your receipt and it will be recorded with it.
        </p>
        <label className="inline-flex items-center gap-2 mt-1.5 text-muted">
          1 {currency} =
          <input
            className="input py-1 w-24 tabular-nums text-right"
            type="text"
            inputMode="decimal"
            placeholder="0.0000"
            value={fx.typed}
            onChange={(e) => fx.setTyped(e.target.value)}
            aria-label={`Rate from ${currency} to ${base}`}
          />
          {base}
        </label>
      </div>
    )
  }

  return (
    <div className="mt-1.5 text-xs text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular-nums">
        {amount > 0 ? (
          <>
            {money(amount, currency)} ={' '}
            <span className="text-ink font-medium">{money(fx.convert(amount), base)}</span>
          </>
        ) : (
          <>
            1 {currency} = {fx.rate.toFixed(4)} {base}
          </>
        )}
      </span>
      <span
        className={classNames('pill', fx.typedRate ? 'bg-gold/15 text-gold' : 'bg-canvas text-muted')}
        title={
          fx.typedRate
            ? 'Your own rate, used instead of the published one'
            : "The European Central Bank's reference rate for that day"
        }
      >
        {fx.typedRate
          ? 'your rate'
          : `ECB ${fx.rateDate === date ? 'rate' : `rate, ${fx.rateDate}`}`}
      </span>
      {!fx.typedRate && (
        <button className="btn-subtle text-xs" onClick={() => fx.setTyped(String(fx.rate))}>
          Use a different rate
        </button>
      )}
      {fx.typedRate && (
        <button className="btn-subtle text-xs" onClick={fx.reset}>
          Back to the published rate
        </button>
      )}
    </div>
  )
}
