import type { AppData } from './types'
import { currentMonth } from './format'

// Luxembourg personal income tax.
//
// Everything here follows the order the ACD's own bulletin d'impôt works in, and
// uses its vocabulary, so a computed year can be held against a real one line by
// line. That is the only way to know a tax model is right: it either reproduces
// an assessment you already have, to the euro, or it does not.
//
// The scale is stocked as published data, never approximated. A bracket estimate
// is not a small error in this domain — one made for 2025 came out roughly
// €11,800 light — so the table below is transcribed from the ACD's tarif and
// verified against a real assessment in the benchmark.

const round2 = (n: number) => Math.round(n * 100) / 100

export type TaxClass = '1' | '1a' | '2'

export interface TaxBand {
  /** Income at which this rate starts. */
  from: number
  rate: number
}

export interface TaxScale {
  year: string
  /** Ascending, first band starting at 0. */
  bands: TaxBand[]
  /** The solidarity surcharge on the tax itself. */
  fondsPourLEmploiPct: number
  /** What the tarif is rounded down to before the scale is applied. */
  roundTo: number
  source: string
}

/**
 * The tarif de base in force from 1 January 2025 — twenty-three bands from 0% to
 * 42%. Verified: an adjusted taxable income of €180,700 under class 2 gives
 * €46,002.00, which is the figure on this household's 2025 bulletin to the cent.
 *
 * There is no separate 2026 tarif. The ACD still gives 1 January 2025 as the
 * last tariff adaptation, so a 2026 forecast is computed on this scale and says
 * so rather than inventing an indexation nobody has published.
 */
const SCALE_2025: TaxScale = {
  year: '2025',
  bands: [
    { from: 0, rate: 0 },
    { from: 13230, rate: 0.08 },
    { from: 15435, rate: 0.09 },
    { from: 17640, rate: 0.1 },
    { from: 19845, rate: 0.11 },
    { from: 22050, rate: 0.12 },
    { from: 24255, rate: 0.14 },
    { from: 26550, rate: 0.16 },
    { from: 28845, rate: 0.18 },
    { from: 31140, rate: 0.2 },
    { from: 33435, rate: 0.22 },
    { from: 35730, rate: 0.24 },
    { from: 38025, rate: 0.26 },
    { from: 40320, rate: 0.28 },
    { from: 42615, rate: 0.3 },
    { from: 44910, rate: 0.32 },
    { from: 47205, rate: 0.34 },
    { from: 49500, rate: 0.36 },
    { from: 51795, rate: 0.38 },
    { from: 54090, rate: 0.39 },
    { from: 117450, rate: 0.4 },
    { from: 176160, rate: 0.41 },
    { from: 234870, rate: 0.42 },
  ],
  fondsPourLEmploiPct: 7,
  roundTo: 50,
  source: 'ACD tarif in force from 1 January 2025',
}

const SCALES: Record<string, TaxScale> = { '2025': SCALE_2025 }

export interface ScaleChoice {
  scale: TaxScale
  /** True when a scale is published for the year actually being computed. */
  published: boolean
}

/**
 * The scale to use for a tax year. A year with no published tarif falls back to
 * the most recent one, flagged, because a forecast built on an invented
 * indexation is worse than one built on last year's law and labelled as such.
 */
export function scaleForYear(year: string): ScaleChoice {
  const exact = SCALES[year]
  if (exact) return { scale: exact, published: true }
  const latest = Object.keys(SCALES).sort().at(-1)!
  return { scale: SCALES[latest], published: false }
}

export function scaleYears(): string[] {
  return Object.keys(SCALES).sort()
}

/** Tax on an income under the base tarif — class 1. */
export function baseTax(scale: TaxScale, income: number): number {
  if (income <= 0) return 0
  let tax = 0
  for (let i = 0; i < scale.bands.length; i++) {
    const band = scale.bands[i]
    if (income <= band.from) break
    const top = scale.bands[i + 1]?.from ?? Infinity
    tax += (Math.min(income, top) - band.from) * band.rate
  }
  return round2(tax)
}

/**
 * Tax under a class. Class 2 is the splitting method: halve the income, tax it
 * on the base tarif, double the result — which is what makes joint assessment
 * worth having, and what a flat "married rate" would get wrong.
 *
 * Class 1a is not implemented. This household is class 2, and a half-remembered
 * 1a formula that quietly produced a number would be worse than one that says
 * it does not know.
 */
export function taxForClass(scale: TaxScale, income: number, taxClass: TaxClass): number {
  if (taxClass === '2') return round2(baseTax(scale, income / 2) * 2)
  if (taxClass === '1') return baseTax(scale, income)
  throw new Error('Class 1a is not modelled — see taxForClass')
}

// ── The household's own facts ─────────────────────────────────────

export interface TaxPersonYear {
  label: string
  /** Everything on the salary certificate: base pay, bonus, RSUs at vesting. */
  gross: number
  /** Social security deductible as a special expense. */
  socialSecurity: number
  /** Complementary pension (LRCP), capped per person. */
  lrcp: number
  /** Tax withheld at source over the year. */
  withholding: number
  /** Income-related expenses lump sum (frais d'obtention). */
  expensesLumpSum: number
  /**
   * Where these figures came from. A certificate is fact; an estimate is this
   * app's arithmetic on what landed in the bank — and the difference has to be
   * on screen, because one of them can be filed and the other cannot.
   */
  source: 'certificate' | 'estimated'
}

export interface TaxYearInput {
  year: string
  people: TaxPersonYear[]
  /** Mortgage interest actually paid on the principal residence, household total. */
  mortgageInterest: number
  /** Premiums that qualify as special expenses (art. 111). */
  insurancePremiums: number
  /** Private pension contributions under art. 111bis, household total. */
  privatePension: number
  /** Tax already paid for the year as quarterly advances. */
  advancesPaid: number
}

export interface TaxSettings {
  taxClass: TaxClass
  /** Both spouses in employment — what earns the abattement extraprofessionnel. */
  bothEmployed: boolean
  /** People in the household sharing the mortgage-interest ceiling. */
  householdSize: number
  /** When the principal residence was first occupied — sets the interest tier. */
  occupancyStart: string
  /**
   * Whether the year of moving in counts as year one of the tiered ceiling.
   * Genuinely unsettled, and worth two thousand euros of deduction in the year
   * the tier turns over, so it is a switch rather than a silent assumption.
   */
  occupancyYearCountsAsFirst: boolean
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  taxClass: '2',
  bothEmployed: true,
  householdSize: 2,
  occupancyStart: '',
  occupancyYearCountsAsFirst: true,
}

/** Fixed figures of the Luxembourg system this model depends on. */
export const LU = {
  /** Income-related expenses, per person, when nothing more is claimed. */
  expensesLumpSum: 540,
  /** The floor under the art. 111 category of special expenses. */
  specialExpensesFloor: { single: 480, jointBothEmployed: 960 },
  /** Insurance premiums deductible as special expenses, per person. */
  insuranceCeilingPerPerson: 672,
  /** Complementary pension, per person. */
  lrcpCeilingPerPerson: 1200,
  /** Deducted from taxable income when both spouses work, class 2. */
  abattementExtraprofessionnel: 4500,
  /** Mortgage interest on the principal residence, per person, by years lived in. */
  mortgageInterestTiers: [
    { throughYear: 5, perPerson: 4000 },
    { throughYear: 10, perPerson: 3000 },
    { throughYear: Infinity, perPerson: 2000 },
  ],
  /** Private pension under art. 111bis, per person. */
  privatePensionCeilingPerPerson: 3200,
} as const

/**
 * The mortgage-interest ceiling for a household in a given tax year. The relief
 * steps down with how long you have lived there — it does not expire — and the
 * step is worth a few hundred euros of tax, so the year it falls is worth being
 * right about.
 */
export function mortgageCeiling(settings: TaxSettings, year: string): { perPerson: number; household: number; occupancyYear: number } {
  if (!settings.occupancyStart) {
    const perPerson = LU.mortgageInterestTiers[0].perPerson
    return { perPerson, household: perPerson * settings.householdSize, occupancyYear: 1 }
  }
  const startYear = Number(settings.occupancyStart.slice(0, 4))
  const offset = settings.occupancyYearCountsAsFirst ? 1 : 0
  const occupancyYear = Number(year) - startYear + offset
  const tier =
    LU.mortgageInterestTiers.find((t) => occupancyYear <= t.throughYear) ??
    LU.mortgageInterestTiers.at(-1)!
  return {
    perPerson: tier.perPerson,
    household: tier.perPerson * settings.householdSize,
    occupancyYear,
  }
}

// ── The assessment ────────────────────────────────────────────────

export interface TaxComputation {
  year: string
  scale: TaxScale
  scalePublished: boolean
  /** Per person, the certificate arithmetic. */
  people: { label: string; gross: number; net: number; withholding: number; source: TaxPersonYear['source'] }[]
  netEmploymentIncome: number
  /** Negative: mortgage interest allowed against the owner-occupied home. */
  netRentalIncome: number
  mortgageInterestPaid: number
  mortgageCeilingHousehold: number
  totalNetIncome: number
  /** The art. 111 category, before the floor is applied. */
  itemisedSpecialExpenses: number
  specialExpensesFloor: number
  /** What the art. 111 category ends up contributing. */
  allowedArt111: number
  socialContributions: number
  lrcp: number
  totalSpecialExpenses: number
  taxableIncome: number
  abattement: number
  adjustedTaxableIncome: number
  roundedForScale: number
  incomeTax: number
  fondsPourLEmploi: number
  totalTaxDue: number
  withholding: number
  advancesPaid: number
  /** Positive = still to pay, negative = refund. */
  balance: number
  effectiveRatePct: number
  /** Tax on one more euro of income, and the saving on one more of deduction. */
  marginalRatePct: number
  /** True when any person's figures are this app's estimate rather than a certificate. */
  estimated: boolean
  /**
   * True when the tax figures come from the bulletin rather than from the
   * scale. A year whose own tarif is not stocked cannot be computed — running
   * it through a later year's scale produces a number that is simply wrong,
   * and quoting that at someone holding the real assessment is worse than
   * quoting the assessment.
   */
  taxFromBulletin: boolean
}

export function computeLuTax(
  settings: TaxSettings,
  input: TaxYearInput,
  /** The assessment already issued for this year, when there is one. */
  assessed?: AssessedYear,
): TaxComputation {
  const { scale, published } = scaleForYear(input.year)

  const people = input.people.map((p) => ({
    label: p.label,
    gross: round2(p.gross),
    net: round2(p.gross - p.expensesLumpSum),
    withholding: round2(p.withholding),
    source: p.source,
  }))
  const netEmploymentIncome = round2(people.reduce((s, p) => s + p.net, 0))

  // The owner-occupied home produces no rent, so the interest allowed against it
  // is a loss — which is exactly how the bulletin carries it.
  const ceiling = mortgageCeiling(settings, input.year)
  const allowedInterest = Math.min(input.mortgageInterest, ceiling.household)
  const netRentalIncome = round2(-allowedInterest)
  const totalNetIncome = round2(netEmploymentIncome + netRentalIncome)

  // Insurance, private pension and debit interest share one category with a
  // floor under it: itemise less than the floor and the floor is what you get,
  // so the first euros of premium are worth nothing at all.
  const insuranceCeiling = LU.insuranceCeilingPerPerson * settings.householdSize
  const allowedInsurance = Math.min(input.insurancePremiums, insuranceCeiling)
  const pensionCeiling = LU.privatePensionCeilingPerPerson * settings.householdSize
  const allowedPension = Math.min(input.privatePension, pensionCeiling)
  const itemisedSpecialExpenses = round2(allowedInsurance + allowedPension)
  const floor =
    settings.taxClass === '2' && settings.bothEmployed
      ? LU.specialExpensesFloor.jointBothEmployed
      : LU.specialExpensesFloor.single
  const allowedArt111 = Math.max(itemisedSpecialExpenses, floor)

  // Mandatory contributions and the complementary pension sit on top of that
  // category rather than inside it, and no floor applies to them.
  const socialContributions = round2(input.people.reduce((s, p) => s + p.socialSecurity, 0))
  const lrcp = round2(
    input.people.reduce((s, p) => s + Math.min(p.lrcp, LU.lrcpCeilingPerPerson), 0),
  )
  const totalSpecialExpenses = round2(allowedArt111 + socialContributions + lrcp)

  const taxableIncome = round2(totalNetIncome - totalSpecialExpenses)
  const abattement =
    settings.taxClass === '2' && settings.bothEmployed ? LU.abattementExtraprofessionnel : 0
  const adjustedTaxableIncome = round2(taxableIncome - abattement)

  // Down to the nearest 50, never to the nearest — the bulletin's own rounding.
  const roundedForScale = Math.max(0, Math.floor(adjustedTaxableIncome / scale.roundTo) * scale.roundTo)
  const computedTax = taxForClass(scale, roundedForScale, settings.taxClass)

  // The scale is the one thing that cannot be improvised. Where the year's own
  // tarif is not stocked but the ACD has already assessed the year, the
  // assessment is the answer and the model contributes the income lines only.
  const useBulletin = !published && !!assessed && assessed.totalTaxDue > 0
  const incomeTax = useBulletin ? round2(assessed!.incomeTax) : computedTax
  const fondsPourLEmploi = useBulletin
    ? round2(assessed!.totalTaxDue - assessed!.incomeTax)
    : round2((computedTax * scale.fondsPourLEmploiPct) / 100)
  const totalTaxDue = useBulletin ? round2(assessed!.totalTaxDue) : round2(incomeTax + fondsPourLEmploi)

  const withholding = round2(people.reduce((s, p) => s + p.withholding, 0))
  const balance = round2(totalTaxDue - withholding - input.advancesPaid)

  // Measured, not assumed: what one more euro of income costs, and therefore
  // what one more euro of deduction saves.
  const step = 1000
  const higher = taxForClass(scale, roundedForScale + step, settings.taxClass)
  const marginal = ((higher - computedTax) / step) * (1 + scale.fondsPourLEmploiPct / 100)

  return {
    year: input.year,
    scale,
    scalePublished: published,
    people,
    netEmploymentIncome,
    netRentalIncome,
    mortgageInterestPaid: round2(input.mortgageInterest),
    mortgageCeilingHousehold: ceiling.household,
    totalNetIncome,
    itemisedSpecialExpenses,
    specialExpensesFloor: floor,
    allowedArt111,
    socialContributions,
    lrcp,
    totalSpecialExpenses,
    taxableIncome,
    abattement,
    adjustedTaxableIncome,
    roundedForScale,
    incomeTax,
    fondsPourLEmploi,
    totalTaxDue,
    withholding,
    advancesPaid: round2(input.advancesPaid),
    balance,
    effectiveRatePct: adjustedTaxableIncome > 0 ? round2((totalTaxDue / adjustedTaxableIncome) * 100) : 0,
    marginalRatePct: round2(marginal * 100),
    estimated: input.people.some((p) => p.source !== 'certificate'),
    taxFromBulletin: useBulletin,
  }
}

// ── Reading the household's own cash flows ────────────────────────

/**
 * What the bank actually saw in a calendar year, from categorised income.
 *
 * `throughMonth` counts only the first N months, so a year still running can be
 * compared against the same stretch of a finished one. Nine months of this year
 * measured against twelve of last would read as a 25% pay cut.
 */
export function incomeReceivedIn(
  data: AppData,
  year: string,
  throughMonth = 12,
): { amount: number; count: number; months: number } {
  let amount = 0
  let count = 0
  const seen = new Set<string>()
  for (const t of data.transactions) {
    if (!t.month.startsWith(year) || t.amount <= 0 || t.category !== 'Income') continue
    if (Number(t.month.slice(5, 7)) > throughMonth) continue
    amount += t.amount
    count++
    seen.add(t.month)
  }
  return { amount: round2(amount), count, months: seen.size }
}

/** What the plan expects to arrive in a year that has not happened yet. */
export function incomePlannedFor(year: string, monthsOf: (m: string) => number): number {
  let total = 0
  for (let m = 1; m <= 12; m++) total += monthsOf(`${year}-${String(m).padStart(2, '0')}`)
  return round2(total)
}

/**
 * The bridge between the bank and the salary certificate: gross pay divided by
 * what actually landed. Employer contributions, social security and withholding
 * all come off before the transfer, so the bank sees roughly three quarters of
 * what the certificate reports — and a year with no certificate can only be
 * estimated by carrying that ratio forward.
 *
 * Derived from a real year rather than assumed, and returned with the year it
 * came from so the estimate can say whose ratio it is using.
 */
export function grossUpFactor(
  data: AppData,
  certifiedYears: TaxYearInput[],
): { factor: number; fromYear: string } | null {
  const usable = certifiedYears
    .filter((y) => y.people.every((p) => p.source === 'certificate'))
    .sort((a, b) => b.year.localeCompare(a.year))
  for (const y of usable) {
    const received = incomeReceivedIn(data, y.year)
    if (received.amount <= 0) continue
    const gross = y.people.reduce((s, p) => s + p.gross, 0)
    if (gross <= 0) continue
    return { factor: round2(gross / received.amount), fromYear: y.year }
  }
  return null
}

/**
 * A year built from what the app knows rather than from a certificate: last
 * certified year's shape, scaled by whatever the bank has actually seen. Every
 * person on it is marked estimated, and nothing here should ever be filed.
 */
export function estimateYear(
  year: string,
  template: TaxYearInput,
  scaleBy: number,
): TaxYearInput {
  return {
    year,
    people: template.people.map((p) => ({
      ...p,
      gross: round2(p.gross * scaleBy),
      socialSecurity: round2(p.socialSecurity * scaleBy),
      withholding: round2(p.withholding * scaleBy),
      source: 'estimated',
    })),
    mortgageInterest: template.mortgageInterest,
    insurancePremiums: template.insurancePremiums,
    privatePension: template.privatePension,
    advancesPaid: 0,
  }
}

/** The tax years worth showing: every year with data, plus the one we're in. */
export function taxYearsInPlay(years: string[]): string[] {
  const set = new Set(years)
  set.add(currentMonth().slice(0, 4))
  return Array.from(set).sort()
}

// ── Stored shape ──────────────────────────────────────────────────

export interface AssessedYear {
  year: string
  /** What the bulletin itself says, so the model can be held against it. */
  adjustedTaxableIncome: number
  incomeTax: number
  totalTaxDue: number
  withholding: number
  advancesPaid: number
  balance: number
  bulletinIssued?: string
}

export interface AdvancePayment {
  dueDate: string
  amount: number
  paid: number
}

export interface TaxData {
  settings: TaxSettings
  years: TaxYearInput[]
  /** Assessments already issued. Facts, never recomputed. */
  assessed: AssessedYear[]
  advances: AdvancePayment[]
  /** Where this came from, so the screen can say. */
  importedFrom?: string
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * Read a Luxembourg tax data file — the shape an accountant's export or a
 * hand-built summary of your bulletins takes — into the app's own model.
 *
 * Deliberately tolerant: a file missing a year, a loan or an insurance total
 * still loads, and whatever is absent shows up on screen as something to fill
 * in rather than as a failure. Nothing personal in it is ever sent anywhere;
 * it lands in this browser's storage like the rest of your data.
 */
export function importLuxTaxFile(raw: unknown): TaxData {
  const doc = (raw ?? {}) as Record<string, any>
  const household = (doc.household ?? {}) as Record<string, any>
  const property = (doc.property ?? {}) as Record<string, any>
  const employment = (doc.employment ?? {}) as Record<string, any>

  const names: string[] = Array.isArray(household.taxpayers)
    ? household.taxpayers.map((t: any) =>
        [t?.forename, t?.surname].filter(Boolean).join(' ').trim() || String(t?.role ?? 'Person'),
      )
    : []

  const settings: TaxSettings = {
    taxClass: String(household.tax_class ?? '2') as TaxClass,
    bothEmployed: employment.both_spouses_employed !== false,
    householdSize: Math.max(1, names.length || 2),
    occupancyStart: String(property.available_since ?? '').slice(0, 10),
    occupancyYearCountsAsFirst: true,
  }

  const loans: any[] = (doc.loans?.items ?? []) as any[]
  const mortgageInterestFor = (year: string): number =>
    loans
      .filter((l) => l?.deductible_as_mortgage_interest)
      .reduce((s, l) => s + num(l?.interest_paid?.[year]), 0)

  const insuranceFor = (year: string): number =>
    num(doc.insurance?.[year]?.deductible_as_special_expenses?.total)

  const years: TaxYearInput[] = []
  const assessed: AssessedYear[] = []
  for (const [year, entry] of Object.entries((doc.tax_years ?? {}) as Record<string, any>)) {
    const salary = (entry?.salary ?? {}) as Record<string, any>
    const people: TaxPersonYear[] = []
    for (const [i, role] of ['taxpayer', 'spouse'].entries()) {
      const p = salary[role]
      if (!p) continue
      people.push({
        label: names[i] ?? (role === 'spouse' ? 'Spouse' : 'Taxpayer'),
        gross: num(p.gross_total),
        socialSecurity: num(p.social_security_deductible),
        lrcp: num(p.lrcp_complementary_pension),
        withholding: num(p.withholding_tax),
        expensesLumpSum: num(p.income_related_expenses_lumpsum, LU.expensesLumpSum),
        // Everything in a filed year comes off a salary certificate.
        source: 'certificate',
      })
    }
    if (!people.length) continue

    const interest = (entry?.property_interest ?? {}) as Record<string, any>
    // The declared figure is what was actually paid; the allowed one is after
    // the ceiling, which this model applies itself.
    const declared = num(interest.declared_taxpayer) + num(interest.declared_spouse)
    years.push({
      year,
      people,
      mortgageInterest: declared || mortgageInterestFor(year),
      insurancePremiums:
        num(entry?.special_expenses?.insurance_premiums_declared) || insuranceFor(year),
      privatePension:
        num(entry?.unused_deductions?.art_111bis_private_pension_taxpayer) +
        num(entry?.unused_deductions?.art_111bis_private_pension_spouse),
      advancesPaid: num(entry?.assessment?.advance_payments_made),
    })

    const a = entry?.assessment
    if (a) {
      assessed.push({
        year,
        adjustedTaxableIncome: num(a.adjusted_taxable_income),
        incomeTax: num(a.income_tax_per_scale),
        totalTaxDue: num(a.total_tax_due),
        withholding: num(a.withholding_deducted) ? Math.abs(num(a.withholding_deducted)) : 0,
        advancesPaid: num(a.advance_payments_made),
        balance: num(a.refund_due) ? -num(a.refund_due) : num(a.balance_remaining),
        bulletinIssued: entry?.bulletin_issued_on,
      })
    }
  }

  const advances: AdvancePayment[] = ((doc.advance_payments?.schedule ?? []) as any[]).map((s) => ({
    dueDate: String(s?.due_date ?? ''),
    amount: num(s?.amount),
    paid: num(s?.paid),
  }))

  return {
    settings,
    years: years.sort((a, b) => a.year.localeCompare(b.year)),
    assessed: assessed.sort((a, b) => a.year.localeCompare(b.year)),
    advances: advances.filter((a) => a.dueDate),
    importedFrom: Array.isArray(doc.source_documents) ? doc.source_documents.join('; ') : undefined,
  }
}

/** What the model still needs before a year can be trusted. */
export interface MissingInput {
  year: string
  field: string
  why: string
}

export function missingInputs(
  tax: TaxData,
  years: string[],
  /** The years actually on screen, estimates included. */
  built: TaxYearInput[] = tax.years,
): MissingInput[] {
  const out: MissingInput[] = []
  if (!tax.settings.occupancyStart) {
    out.push({
      year: '—',
      field: 'When you moved into the property',
      why: 'Sets which mortgage-interest tier applies, which is worth up to €4,000 of deduction a year.',
    })
  }
  for (const year of years) {
    const y = built.find((x) => x.year === year)
    if (!y) {
      out.push({
        year,
        field: 'Salary figures',
        why: 'No certificate and nothing to estimate from — gross pay, social security and tax withheld.',
      })
      continue
    }
    for (const p of y.people) {
      if (p.source === 'certificate') continue
      out.push({
        year,
        field: `${p.label} — salary certificate`,
        why: 'Estimated from what reached the bank. The certificate (modèle 160) arrives in March and replaces the guess.',
      })
    }
    if (y.mortgageInterest <= 0 && tax.settings.occupancyStart) {
      out.push({
        year,
        field: 'Mortgage interest paid',
        why: 'Deductible against the home up to the tier ceiling.',
      })
    }
  }
  return out
}
