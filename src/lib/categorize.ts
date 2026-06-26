// Lightweight, rule-based categorisation of imported transactions.
// Runs entirely on-device — no description text ever leaves the browser
// unless the user explicitly asks the assistant about it.

export const CATEGORIES = [
  'Income',
  'Housing',
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
  'Kids',
  'Fees',
  'Transfer',
  'Savings',
  'Other',
] as const

const RULES: Array<[RegExp, string]> = [
  [/salary|payroll|paycheck|direct dep|deposit|invoice|stripe|payout/i, 'Income'],
  [/rent|mortgage|landlord|hoa|property/i, 'Housing'],
  [/grocery|supermarket|whole foods|trader joe|aldi|costco|safeway|kroger|tesco|mercadona|carrefour/i, 'Food'],
  [/restaurant|cafe|coffee|starbucks|mcdonald|uber eats|doordash|grubhub|deliveroo|dinner|lunch|bar /i, 'Dining'],
  [/uber|lyft|metro|transit|gas |fuel|shell|chevron|parking|train|bus |toll/i, 'Transport'],
  [/electric|water|gas bill|utility|comcast|verizon|at&t|internet|broadband|phone/i, 'Utilities'],
  [/netflix|spotify|hulu|disney|youtube|prime|icloud|dropbox|notion|subscription|membership/i, 'Subscriptions'],
  [/amazon|target|walmart|store|shop|ikea|best buy|aliexpress|etsy/i, 'Shopping'],
  [/pharmacy|cvs|walgreens|doctor|dental|clinic|hospital|medical|gym|fitness/i, 'Health'],
  [/insurance|geico|allstate|state farm|premium/i, 'Insurance'],
  [/cinema|movie|theater|concert|ticketmaster|steam|playstation|xbox/i, 'Entertainment'],
  [/airline|flight|hotel|airbnb|expedia|booking\.com|delta|united|ryanair/i, 'Travel'],
  [/tuition|udemy|coursera|university|course|textbook/i, 'Education'],
  [/fee|charge|interest|atm|overdraft/i, 'Fees'],
  [/transfer|zelle|venmo|paypal|wire/i, 'Transfer'],
  [/savings|vanguard|fidelity|401k|ira|investment|brokerage/i, 'Savings'],
]

export function categorize(description: string, amount: number): string {
  for (const [re, cat] of RULES) {
    if (re.test(description)) return cat
  }
  // Fall back on the sign: a positive amount with no match is likely income.
  return amount > 0 ? 'Income' : 'Other'
}
