// Lightweight, rule-based categorisation of imported transactions.
// Runs entirely on-device — no description text ever leaves the browser
// unless the user explicitly asks the assistant about it.

export const CATEGORIES = [
  'Income',
  'Housing',
  'Home expenses',
  'Loans',
  'Food',
  'Dining',
  'Transport',
  'Utilities',
  'Subscriptions',
  'Shopping',
  'Health',
  'Insurance',
  'Entertainment',
  'Travel',
  'Education',
  'Taxes',
  'Provisions',
  'Baby',
  'Kids',
  'Fees',
  'Transfer',
  'Internal',
  'Savings',
  'Other',
] as const

/**
 * Categories that move money between the user's own accounts rather than in or
 * out of their finances. Excluded from income, expenses and every average built
 * on them — counting a transfer as spending would report the same euro twice.
 */
export const NON_CASHFLOW = new Set<string>(['Internal'])

// Rules are tried in order — first match wins, so more specific / higher-priority
// categories come first. Alongside the US/UK merchants, these cover the Spanish
// & European merchants a Revolut export tends to carry (the app's home turf).
const RULES: Array<[RegExp, string]> = [
  [/salary|payroll|paycheck|direct dep|deposit|invoice|stripe|payout|\bn[oó]mina\b|prestaci[oó]n|\bpensi[oó]n\b|reembolso|abono\b/i, 'Income'],
  [/rent|mortgage|landlord|hoa|property|alquiler|hipoteca|inmobiliaria|comunidad de propietarios/i, 'Housing'],
  // Furniture, DIY and home-improvement stores.
  [/\bikea\b|hornbach|batiself|leroy merlin|brico|castorama|home depot/i, 'Home expenses'],
  [/grocery|supermarket|whole foods|trader joe|aldi|costco|safeway|kroger|tesco|mercadona|carrefour|\blidl\b|eroski|alcampo|consum |ahorramas|hipercor|supercor|caprabo|condis|\bgadis\b|froiz|bonpreu|supermercado|fruter[ií]a|carnicer[ií]a|auchan|cactus|delhaize|colruyt|\bcora\b/i, 'Food'],
  [/restaurant|cafe|coffee|starbucks|mcdonald|uber eats|doordash|grubhub|deliveroo|dinner|lunch|bar |restaurante|cervecer|taberna|taper[ií]a|mes[oó]n|telepizza|domino|burger king|\bkfc\b|goiko|montaditos|foster'?s hollywood|glovo|just ?eat|pizzer[ií]a|\btapas\b|churrer[ií]a|heladoler|\bvips\b|rodilla/i, 'Dining'],
  [/uber|lyft|metro|transit|gas |fuel|shell|chevron|parking|train|bus |toll|cabify|\bbolt\b|free ?now|renfe|cercan[ií]as|\bemt\b|\balsa\b|blablacar|repsol|cepsa|\bgalp\b|petronor|gasolinera|aparcamiento|telepeaje|autopista|\bpeaje\b|\bavanza\b|\btmb\b|petroprix|\bbp\b|\besso\b|\baral\b/i, 'Transport'],
  [/electric|water|gas bill|utility|comcast|verizon|at&t|internet|broadband|phone|iberdrola|endesa|naturgy|holaluz|movistar|vodafone|\borange\b|yoigo|m[aá]smovil|pepephone|jazztel|\bdigi\b|aqualia|hidroel|telef[oó]nica|factura de (luz|agua|gas)/i, 'Utilities'],
  [/netflix|spotify|hulu|disney|youtube|prime|icloud|dropbox|notion|subscription|membership|\bhbo\b|dazn|filmin|app ?store|itunes|google play|playstation plus|game ?pass|patreon|audible|kindle unlimited|linkedin premium/i, 'Subscriptions'],
  [/prenatal|imaginarium|chicco|pa[ñn]ales|suavinex|\bdodot\b|beb[eé]s?\b|mothercare|carricoche|cochecito|puericultura/i, 'Baby'],
  [/guarder[ií]a|escuela infantil|juguettos|toys ?r ?us|eurekakids|\bcanguro\b|ni[ñn]era|ludoteca|parque infantil/i, 'Kids'],
  [/amazon|target|walmart|store|shop|best buy|aliexpress|etsy|corte ingl[eé]s|\bzara\b|\bmango\b|bershka|pull ?& ?bear|pull and bear|stradivarius|massimo dutti|primark|decathlon|media ?markt|pccomponentes|pc componentes|\bfnac\b|springfield|lefties|worten|shein|temu|\bhm\b|uniqlo|rituals|\baction\b/i, 'Shopping'],
  [/pharmacy|cvs|walgreens|doctor|dental|clinic|hospital|medical|gym|fitness|farmac|pharmacie|\bpharma\b|cl[ií]nica|dentista|fisio|[oó]ptica|quir[oó]n|vithas|podolog|psic[oó]log|laboratorio|analisis/i, 'Health'],
  [/insurance|geico|allstate|state farm|premium|mapfre|mutua|adeslas|asisa|\bdkv\b|sanitas|\baxa\b|allianz|l[ií]nea directa|zurich|generali|pelayo|catalana occidente|\bseguro|assurance|\bfoyer\b/i, 'Insurance'],
  [/cinema|movie|theater|concert|ticketmaster|steam|playstation|xbox|yelmo|cinesa|kinepolis|\bocine\b|teatro|museo|entradas|festival|\bferia\b/i, 'Entertainment'],
  [/airline|flight|hotel|airbnb|expedia|booking\.com|delta|united|ryanair|iberia|vueling|air europa|easyjet|wizz air|transavia|meli[aá]|barcel[oó]|paradores|hostal|logitravel|edreams|halc[oó]n viajes|civitatis|\biryo\b|ouigo|goldcar/i, 'Travel'],
  [/tuition|udemy|coursera|university|course|textbook|colegio|matr[ií]cula|academia|oposici[oó]n|librer[ií]a|escuela\b/i, 'Education'],
  [/hacienda|agencia tributaria|impuesto|\birpf\b|seguridad social|\btgss\b|aut[oó]nomo|\btasa\b|\bdgt\b|\bmulta\b|tributo/i, 'Taxes'],
  [/fee|charge|interest|atm|overdraft|comisi[oó]n|\bcuota\b/i, 'Fees'],
  // Money moved between your own accounts (e.g. a top-up to Revolut) — not
  // spending. Kept out of money-date income/expense totals.
  [/\brevolut\b|to my|own account|internal transfer|traspaso interno/i, 'Internal'],
  [/transfer|zelle|venmo|paypal|wire|bizum|transferencia|traspaso/i, 'Transfer'],
  [/savings|vanguard|fidelity|401k|ira|investment|brokerage|ahorro|indexa|myinvestor|fondo indexado/i, 'Savings'],
]

// Categories that only make sense for money going out. A credit (money in)
// that matches one of these — e.g. a salary paid by "AMAZON EU", or a refund —
// is almost never a spending row, so we route it to Income instead of, say,
// Shopping. Neutral buckets (Transfer, Savings, Fees, Income) are left alone.
const EXPENSE_ONLY = new Set([
  'Housing', 'Home expenses', 'Loans', 'Food', 'Dining', 'Transport', 'Utilities', 'Subscriptions',
  'Shopping', 'Health', 'Insurance', 'Entertainment', 'Travel', 'Education',
  'Taxes', 'Baby', 'Kids',
])

export function categorize(description: string, amount: number): string {
  for (const [re, cat] of RULES) {
    if (re.test(description)) {
      if (amount > 0 && EXPENSE_ONLY.has(cat)) return 'Income'
      return cat
    }
  }
  // Fall back on the sign: a positive amount with no match is likely income.
  return amount > 0 ? 'Income' : 'Other'
}

// ── User-taught rules ─────────────────────────────────────────────

/** The category a user rule assigns to a description, or null if none match. */
export function matchRule(
  description: string,
  rules: import('./types').CategoryRule[] | undefined,
): string | null {
  if (!rules?.length) return null
  const d = description.toLowerCase()
  for (const r of rules) {
    const m = r.match.trim().toLowerCase()
    if (m && d.includes(m)) return r.category
  }
  return null
}

// Generic banking words that make a poor rule keyword — skipped when guessing.
const NOISE = new Set([
  'debit', 'credit', 'transfer', 'direct', 'standing', 'order', 'instant', 'sepa',
  'payment', 'carte', 'visa', 'tpv', 'fees', 'for', 'the', 'and', 'favour', 'from',
  'net', 'card', 'purchase', 'pos', 'www', 'com',
])

/** A sensible starting keyword for a new rule, drawn from a noisy description. */
export function suggestKeyword(description: string): string {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  // Only a genuinely distinctive token makes a good rule; if a description is
  // all boilerplate/numbers, return nothing so we don't learn an over-broad rule.
  const pick = words.find((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w))
  return pick ?? ''
}

/** Upsert a rule (match is unique) into a rules array, returning a new array. */
export function withRule(
  rules: import('./types').CategoryRule[] | undefined,
  id: string,
  match: string,
  category: string,
): import('./types').CategoryRule[] {
  const m = match.trim()
  const list = rules ? [...rules] : []
  const i = list.findIndex((r) => r.match.trim().toLowerCase() === m.toLowerCase())
  if (i >= 0) list[i] = { ...list[i], category }
  else list.push({ id, match: m, category })
  return list
}
