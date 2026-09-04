import { useMemo, useState } from 'react'
import { useData } from '../store'
import {
  DEFAULT_TAX_SETTINGS,
  LU,
  computeLuTax,
  estimateYear,
  grossUpFactor,
  importLuxTaxFile,
  incomeReceivedIn,
  missingInputs,
  mortgageCeiling,
  scaleForYear,
  type TaxComputation,
  type TaxData,
  type TaxYearInput,
} from '../lib/tax'
import { formatMoney, classNames, currentMonth, todayISO, parseAmount } from '../lib/format'
import { IconUpload, IconCheck, IconClose } from './icons'

/** A line of the assessment, laid out the way the bulletin lays it out. */
function Line({
  label,
  value,
  note,
  strong,
  negative,
}: {
  label: string
  value: string
  note?: string
  strong?: boolean
  negative?: boolean
}) {
  return (
    <div
      className={classNames(
        'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 border-b border-line/50 last:border-0',
        strong && 'font-medium',
      )}
    >
      <div className="min-w-0">
        <span className={classNames('break-words', strong ? 'text-ink' : 'text-muted')}>{label}</span>
        {note && <div className="text-xs text-muted">{note}</div>}
      </div>
      <span className={classNames('tabular-nums shrink-0 ml-auto', negative && 'text-clay')}>{value}</span>
    </div>
  )
}

export function Tax() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, opts)
  const thisYear = currentMonth().slice(0, 4)
  const tax = data.tax

  const [paste, setPaste] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [openYear, setOpenYear] = useState<string | null>(null)

  function loadFile(text: string) {
    try {
      const parsed = importLuxTaxFile(JSON.parse(text))
      if (!parsed.years.length && !parsed.assessed.length) {
        setPasteError('That file parsed, but carried no tax years the model could read.')
        return
      }
      update((d) => {
        d.tax = parsed
        return d
      })
      setPaste('')
      setPasteError('')
    } catch {
      setPasteError("That isn't valid JSON. Paste the file's whole contents, braces included.")
    }
  }

  /**
   * Every year worth showing: the ones with figures, plus the year we are
   * living in — which is the one the forecast is actually for.
   */
  const years = useMemo(() => {
    const set = new Set<string>(tax?.years.map((y) => y.year) ?? [])
    set.add(thisYear)
    return Array.from(set).sort().reverse()
  }, [tax, thisYear])

  /**
   * A year the app has no certificate for is estimated: last certified year's
   * shape, scaled by what the bank has actually seen since. Marked estimated all
   * the way through, because it is arithmetic on a bank balance, not a document
   * anyone can file.
   */
  const built = useMemo(() => {
    if (!tax) return []
    const factor = grossUpFactor(data, tax.years)
    return years.map((year) => {
      // Advances actually paid in a year belong to that year's balance, wherever
      // the figures for it came from — they are money already handed over.
      const advancesPaid = tax.advances
        .filter((a) => a.dueDate.startsWith(year))
        .reduce((s, a) => s + a.paid, 0)

      const stored = tax.years.find((y) => y.year === year)
      if (stored) {
        return {
          year,
          input: { ...stored, advancesPaid: Math.max(stored.advancesPaid, advancesPaid) },
          basis: 'stored' as const,
          factor,
        }
      }

      const template = [...tax.years].sort((a, b) => b.year.localeCompare(a.year))[0]
      if (!template) return { year, input: null, basis: 'none' as const, factor }

      const received = incomeReceivedIn(data, year)
      // Like for like: this year so far against the same months of the
      // certified one. Nine months measured against twelve would read as a
      // quarter of the salary gone.
      const throughMonth = year === thisYear ? Number(currentMonth().slice(5, 7)) : 12
      const sameStretch = incomeReceivedIn(data, template.year, throughMonth)
      const comparable = received.amount > 0 && sameStretch.amount > 0
      const scaleBy = comparable ? received.amount / sameStretch.amount : 1
      return {
        year,
        input: { ...estimateYear(year, template, scaleBy), advancesPaid },
        // Only a comparison the app could actually make counts as one.
        basis: comparable ? ('cashflow' as const) : ('lastYear' as const),
        factor,
        received: received.amount,
        comparedWith: sameStretch.amount,
        throughMonth,
      }
    })
  }, [tax, data, years])

  const computed = useMemo(() => {
    if (!tax) return new Map<string, TaxComputation>()
    const out = new Map<string, TaxComputation>()
    for (const b of built) {
      if (!b.input) continue
      out.set(b.year, computeLuTax(tax.settings, b.input, tax.assessed.find((a) => a.year === b.year)))
    }
    return out
  }, [tax, built])

  const missing = useMemo(
    () =>
      tax
        ? missingInputs(
            tax,
            years,
            built.map((b) => b.input).filter((i): i is TaxYearInput => !!i),
          )
        : [],
    [tax, years, built],
  )

  const nextAdvance = useMemo(() => {
    const today = todayISO()
    return (tax?.advances ?? [])
      .filter((a) => a.paid < a.amount - 0.005)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .find((a) => a.dueDate >= today)
  }, [tax])

  const outstanding = useMemo(
    () => (tax?.advances ?? []).reduce((s, a) => s + Math.max(0, a.amount - a.paid), 0),
    [tax],
  )

  function setSettings(fields: Partial<TaxData['settings']>) {
    update((d) => {
      if (!d.tax) return d
      d.tax.settings = { ...d.tax.settings, ...fields }
      return d
    })
  }

  function setYearField(year: string, fields: Partial<TaxYearInput>) {
    update((d) => {
      if (!d.tax) return d
      const y = d.tax.years.find((x) => x.year === year)
      if (y) Object.assign(y, fields)
      else d.tax.years.push({ ...(built.find((b) => b.year === year)!.input as TaxYearInput), ...fields })
      return d
    })
  }

  function markAdvancePaid(dueDate: string, amount: number) {
    update((d) => {
      const a = d.tax?.advances.find((x) => x.dueDate === dueDate)
      if (a) a.paid = amount
      return d
    })
  }

  // ── Nothing loaded yet ──
  if (!tax) {
    return (
      <div className="space-y-6 animate-fade-up">
        <div>
          <h2 className="text-2xl">Tax</h2>
          <p className="text-muted">Luxembourg income tax, worked out from what you actually earn and owe</p>
        </div>
        <div className="card p-6">
          <h3 className="text-lg">Start with what the ACD already told you</h3>
          <p className="text-sm text-muted mt-1 mb-4">
            Paste a tax data file — your bulletins, salary certificates and loan statements gathered into
            JSON. It stays in this browser like everything else here; nothing is uploaded. Two assessed
            years are enough for the model to check itself against and to forecast from.
          </p>
          <textarea
            className="input font-mono text-xs h-40 w-full"
            placeholder='{ "$schema_version": "1.0", "household": { … }, "tax_years": { … } }'
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          {pasteError && <p className="text-xs text-clay mt-2">{pasteError}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button className="btn-primary" onClick={() => loadFile(paste)} disabled={!paste.trim()}>
              <IconUpload width={16} height={16} /> Load it
            </button>
            <label className="btn-ghost cursor-pointer">
              Choose a file
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) loadFile(await file.text())
                }}
              />
            </label>
            <button
              className="btn-subtle text-xs"
              onClick={() =>
                update((d) => {
                  d.tax = { settings: { ...DEFAULT_TAX_SETTINGS }, years: [], assessed: [], advances: [] }
                  return d
                })
              }
            >
              Or start empty and type it in
            </button>
          </div>
        </div>
      </div>
    )
  }

  const current = computed.get(openYear ?? years[0])
  const currentBasis = built.find((b) => b.year === (openYear ?? years[0]))
  const assessedForYear = tax.assessed.find((a) => a.year === (openYear ?? years[0]))
  const ceiling = mortgageCeiling(tax.settings, openYear ?? years[0])
  const scale = scaleForYear(openYear ?? years[0])

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl">Tax</h2>
          <p className="text-muted">
            Luxembourg · class {tax.settings.taxClass}
            {tax.settings.taxClass === '2' && ' (joint, splitting)'} ·{' '}
            {tax.settings.householdSize === 1 ? 'one person' : `${tax.settings.householdSize} people`}
          </p>
        </div>
        <select
          className="input w-auto"
          value={openYear ?? years[0]}
          onChange={(e) => setOpenYear(e.target.value)}
          aria-label="Tax year"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
              {computed.get(y)?.estimated ? ' — forecast' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* What is still owed, which is the question you open this for. */}
      {(nextAdvance || outstanding > 0.5) && (
        <div className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-lg">Advance payments</h3>
            <span className="tabular-nums text-sm text-muted">{fx(outstanding)} still to pay</span>
          </div>
          <p className="text-sm text-muted mb-3">
            Quarterly, set by the ACD from your last assessment. Missing one costs 0.6% a month, so they
            are the one tax date worth a reminder.
          </p>
          <div className="space-y-2">
            {tax.advances.map((a) => {
              const due = a.amount - a.paid
              const overdue = due > 0.005 && a.dueDate < todayISO()
              return (
                <div
                  key={a.dueDate}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-line bg-canvas px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{a.dueDate}</div>
                    <div className={classNames('text-xs', overdue ? 'text-clay' : 'text-muted')}>
                      {due <= 0.005
                        ? 'paid'
                        : overdue
                          ? 'that day has passed'
                          : a.dueDate === nextAdvance?.dueDate
                            ? 'next one due'
                            : 'to come'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-auto">
                    <span className="tabular-nums text-sm">{fx(a.amount)}</span>
                    {due <= 0.005 ? (
                      <span className="pill bg-forest-tint text-forest">
                        <IconCheck width={12} height={12} /> paid
                      </span>
                    ) : (
                      <button
                        className="btn-subtle text-xs"
                        onClick={() => markAdvancePaid(a.dueDate, a.amount)}
                      >
                        Mark paid
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {current && currentBasis && (
        <>
          {/* How this year's figures were arrived at, before any of them are shown. */}
          <div
            className={classNames(
              'card p-5',
              current.estimated ? 'border-gold/50 bg-gold/5' : '',
            )}
          >
            <h3 className="text-lg">
              {current.estimated ? `${current.year} — a forecast` : `${current.year} — from your certificates`}
            </h3>
            <p className="text-sm text-muted mt-1">
              {currentBasis.basis === 'stored' && !current.estimated
                ? 'Every figure below comes off a salary certificate or a statement. This is what the return says.'
                : currentBasis.basis === 'cashflow'
                  ? `Estimated from your own cash flows. ${fx(
                      currentBasis.received ?? 0,
                    )} of salary has reached your accounts through month ${
                      currentBasis.throughMonth
                    }, against ${fx(
                      currentBasis.comparedWith ?? 0,
                    )} over the same months of the last certified year — so the certificates are scaled by that same proportion to get gross.`
                  : 'Estimated by carrying the last certified year forward unchanged. There is no salary recorded in this year to compare against, so nothing has been scaled — correct the figures below as soon as you know them.'}
            </p>
            {current.taxFromBulletin ? (
              <p className="text-xs text-muted mt-2">
                The {current.year} tarif is not stocked here, so the tax itself is taken from your
                bulletin rather than recomputed. Everything above it — income, deductions, taxable
                income — is the model's own working, and matches.
              </p>
            ) : (
              !scale.published && (
                <p className="text-xs text-muted mt-2">
                  No tarif has been published for {current.year}. This uses the {scale.scale.year} scale
                  — the ACD still gives 1 January 2025 as the last adaptation — so an indexation, if one
                  comes, would lower the figure a little.
                </p>
              )
            )}
            {current.estimated && (
              <p className="text-xs text-muted mt-2">
                Nothing here can be filed. The certificates (modèle 160) arrive in March and replace it.
              </p>
            )}
          </div>

          {/* The assessment, in the bulletin's own order and words. */}
          <div className="card p-6">
            <h3 className="text-lg mb-3">How it is worked out</h3>
            <div className="text-sm">
              {current.people.map((p) => (
                <Line
                  key={p.label}
                  label={p.label}
                  note={`${fx(p.gross)} gross, less ${fx(LU.expensesLumpSum)} lump-sum expenses${
                    p.source === 'estimated' ? ' · estimated' : ''
                  }`}
                  value={fx(p.net)}
                />
              ))}
              <Line label="Net employment income" value={fx(current.netEmploymentIncome)} strong />
              <Line
                label="Net rental income"
                note={
                  current.mortgageInterestPaid > current.mortgageCeilingHousehold
                    ? `${fx(current.mortgageInterestPaid)} of mortgage interest paid, capped at ${fx(
                        ceiling.perPerson,
                      )} each — year ${ceiling.occupancyYear} of living there`
                    : `mortgage interest on the home you live in`
                }
                value={fx(current.netRentalIncome, { signed: true })}
              />
              <Line label="Total net income" value={fx(current.totalNetIncome)} strong />
              <Line
                label="Special expenses"
                note={`${fx(current.socialContributions)} social security · ${fx(
                  current.lrcp,
                )} complementary pension · ${fx(current.allowedArt111)} insurance and pension${
                  current.itemisedSpecialExpenses < current.specialExpensesFloor
                    ? ` (the ${fx(current.specialExpensesFloor)} floor, not the ${fx(
                        current.itemisedSpecialExpenses,
                      )} you actually paid)`
                    : ''
                }`}
                value={`−${fx(current.totalSpecialExpenses)}`}
              />
              <Line label="Taxable income" value={fx(current.taxableIncome)} strong />
              {current.abattement > 0 && (
                <Line
                  label="Abattement extraprofessionnel"
                  note="both of you in employment, class 2"
                  value={`−${fx(current.abattement)}`}
                />
              )}
              <Line label="Adjusted taxable income" value={fx(current.adjustedTaxableIncome)} strong />
              <Line
                label="Income tax"
                note={
                  current.taxFromBulletin
                    ? `from your ${current.year} bulletin — that year's tarif is not stocked here`
                    : `on ${fx(current.roundedForScale)}, rounded down to the nearest ${
                        current.scale.roundTo
                      } · ${current.scale.source}`
                }
                value={fx(current.incomeTax)}
              />
              <Line
                label="Fonds pour l'emploi"
                note={`${current.scale.fondsPourLEmploiPct}% on the tax`}
                value={fx(current.fondsPourLEmploi)}
              />
              <Line label="Total tax due" value={fx(current.totalTaxDue)} strong />
              <Line label="Withheld at source" value={`−${fx(current.withholding)}`} />
              {current.advancesPaid > 0.5 && (
                <Line label="Advances already paid" value={`−${fx(current.advancesPaid)}`} />
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="label">{current.balance >= 0 ? 'Still to pay' : 'Refund due'}</div>
                <div
                  className={classNames(
                    'stat-value tabular-nums',
                    current.balance >= 0 ? 'text-clay' : 'text-forest',
                  )}
                >
                  {fx(Math.abs(current.balance))}
                </div>
              </div>
              <div className="text-right text-sm text-muted">
                <div className="tabular-nums">
                  {current.effectiveRatePct.toFixed(2)}% effective ·{' '}
                  {current.marginalRatePct.toFixed(2)}% on the next euro
                </div>
                <div className="text-xs">
                  So a euro of extra deduction is worth {fx(current.marginalRatePct / 100)}.
                </div>
              </div>
            </div>

            {/* Held against the real thing, when there is a real thing. */}
            {assessedForYear && !current.taxFromBulletin && (
              <div className="mt-4 pt-3 border-t border-line text-sm">
                {Math.abs(assessedForYear.totalTaxDue - current.totalTaxDue) < 1 ? (
                  <p className="text-forest">
                    <IconCheck width={14} height={14} /> Matches the bulletin issued{' '}
                    {assessedForYear.bulletinIssued} to the euro.
                  </p>
                ) : (
                  <p className="text-clay">
                    The bulletin issued {assessedForYear.bulletinIssued} says{' '}
                    {fx(assessedForYear.totalTaxDue)} — this model gets {fx(current.totalTaxDue)}, a
                    difference of {fx(Math.abs(assessedForYear.totalTaxDue - current.totalTaxDue))}.
                    Trust the bulletin.
                  </p>
                )}
              </div>
            )}
            {assessedForYear && current.taxFromBulletin && (
              <div className="mt-4 pt-3 border-t border-line text-sm text-muted">
                As assessed, bulletin issued {assessedForYear.bulletinIssued}.
              </div>
            )}
          </div>

          {/* The lever this household has never pulled. */}
          {current.itemisedSpecialExpenses < LU.privatePensionCeilingPerPerson * tax.settings.householdSize && (
            <div className="card p-5">
              <h3 className="text-lg">The deduction you aren't using</h3>
              <p className="text-sm text-muted mt-1">
                A private pension under article 111bis is deductible up to{' '}
                {fx(LU.privatePensionCeilingPerPerson)} each —{' '}
                {fx(LU.privatePensionCeilingPerPerson * tax.settings.householdSize)} for the household.
                You have claimed {fx(current.itemisedSpecialExpenses)} in that category, and while it sits
                under the {fx(current.specialExpensesFloor)} floor, the insurance premiums you do pay are
                worth nothing at all.
              </p>
              {(() => {
                const full = LU.privatePensionCeilingPerPerson * tax.settings.householdSize
                const withIt = computeLuTax(tax.settings, {
                  ...(currentBasis.input as TaxYearInput),
                  privatePension: full,
                })
                const saving = current.totalTaxDue - withIt.totalTaxDue
                return (
                  <div className="mt-3 rounded-lg border border-forest/25 bg-forest-tint/10 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="text-sm">Contribute {fx(full)} and this year's tax falls by</span>
                      <span className="tabular-nums text-lg text-forest">{fx(saving)}</span>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {Math.round((saving / full) * 100)}% back on the money — the premiums already under
                      the floor start counting too, once the category clears it.
                    </p>
                  </div>
                )
              })()}
            </div>
          )}
        </>
      )}

      {/* What the model still needs. */}
      <div className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-lg">What's still missing</h3>
          {missing.length === 0 && <span className="pill bg-forest-tint text-forest">nothing</span>}
        </div>
        {missing.length === 0 ? (
          <p className="text-sm text-muted mt-1">
            Every figure the model needs is either a document you have given it or, for a year still
            running, an estimate it has told you about.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted mt-1 mb-3">
              Each of these changes the answer. Until they are filled in, the figures above stand on a
              guess in that place.
            </p>
            <div className="space-y-2">
              {missing.map((m, i) => (
                <div key={`${m.year}-${m.field}-${i}`} className="rounded-lg border border-line bg-canvas px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{m.field}</span>
                    <span className="pill bg-line/50 text-muted">{m.year}</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">{m.why}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* The one genuinely unsettled reading, made a switch rather than a guess. */}
        <div className="mt-4 pt-4 border-t border-line">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={tax.settings.occupancyYearCountsAsFirst}
              onChange={(e) => setSettings({ occupancyYearCountsAsFirst: e.target.checked })}
            />
            <span className="text-sm">
              <span className="font-medium">The year you moved in counts as year one</span>
              <span className="block text-muted text-xs mt-0.5">
                The mortgage-interest ceiling steps down after five years, and whether a December move-in
                makes that year count decides which calendar year the step falls in. Worth{' '}
                {fx(2000)} of deduction in that year. Both readings exist; the ACD's own bulletins will
                settle it.
              </span>
            </span>
          </label>
          <div className="mt-3">
            <label className="label" htmlFor="tax-occupancy">
              Living there since
            </label>
            <input
              id="tax-occupancy"
              className="input w-auto"
              type="date"
              value={tax.settings.occupancyStart}
              onChange={(e) => setSettings({ occupancyStart: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Correcting a year by hand. */}
      {current && currentBasis?.input && (
        <div className="card p-5">
          <h3 className="text-lg">Correct {current.year} by hand</h3>
          <p className="text-sm text-muted mt-1 mb-3">
            Anything the model got from a document or worked out for itself can be overwritten here — a
            bonus it did not know about, a premium it has not seen.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'mortgageInterest' as const, label: 'Mortgage interest paid' },
              { key: 'insurancePremiums' as const, label: 'Deductible insurance premiums' },
              { key: 'privatePension' as const, label: 'Private pension (art. 111bis)' },
              { key: 'advancesPaid' as const, label: 'Advances paid for this year' },
            ].map((f) => (
              // Keyed by year: an uncontrolled input keeps the value it first
              // rendered with, so without this, switching year left the
              // previous year's figures sitting under the new one's heading.
              <div key={`${current.year}-${f.key}`}>
                <label className="label" htmlFor={`tax-${f.key}`}>
                  {f.label}
                </label>
                <input
                  id={`tax-${f.key}`}
                  className="input tabular-nums text-right"
                  type="text"
                  inputMode="decimal"
                  key={`${current.year}-${f.key}`}
                  defaultValue={(currentBasis.input as TaxYearInput)[f.key]}
                  onBlur={(e) => {
                    const v = parseAmount(e.target.value)
                    if (v !== null && Number.isFinite(v)) setYearField(current.year, { [f.key]: v })
                  }}
                />
              </div>
            ))}
          </div>
          {(currentBasis.input as TaxYearInput).people.map((p, i) => (
            <div key={`${current.year}-${p.label}`} className="mt-4 pt-3 border-t border-line">
              <div className="flex flex-wrap items-baseline gap-2 mb-2">
                <span className="font-medium text-sm">{p.label}</span>
                <span
                  className={classNames(
                    'pill',
                    p.source === 'certificate' ? 'bg-forest-tint text-forest' : 'bg-gold/15 text-gold',
                  )}
                >
                  {p.source === 'certificate' ? 'from a certificate' : 'estimated'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { key: 'gross' as const, label: 'Gross pay' },
                  { key: 'socialSecurity' as const, label: 'Social security' },
                  { key: 'withholding' as const, label: 'Tax withheld' },
                ].map((f) => (
                  <div key={`${current.year}-${i}-${f.key}`}>
                    <label className="label" htmlFor={`tax-${i}-${f.key}`}>
                      {f.label}
                    </label>
                    <input
                      id={`tax-${i}-${f.key}`}
                      className="input tabular-nums text-right"
                      type="text"
                      inputMode="decimal"
                      key={`${current.year}-${i}-${f.key}`}
                      defaultValue={p[f.key]}
                      onBlur={(e) => {
                        const v = parseAmount(e.target.value)
                        if (v === null || !Number.isFinite(v)) return
                        const people = (currentBasis.input as TaxYearInput).people.map((q, j) =>
                          // Typing a figure in makes it yours, not a guess.
                          j === i ? { ...q, [f.key]: v, source: 'certificate' as const } : q,
                        )
                        setYearField(current.year, { people })
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          className="btn-subtle text-xs text-clay"
          onClick={() => {
            if (!confirm('Remove all tax data from this browser?')) return
            update((d) => {
              d.tax = undefined
              return d
            })
          }}
        >
          <IconClose width={13} height={13} /> Remove tax data
        </button>
      </div>
    </div>
  )
}
