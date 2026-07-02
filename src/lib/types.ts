// ── Core domain model ─────────────────────────────────────────────
// Everything here is persisted locally (browser storage) and/or to the
// user's own Google Drive via JSON export. None of it touches GitHub.

export type Cadence =
  | 'monthly'
  | 'weekly'
  | 'biweekly'
  | 'quarterly'
  | 'annual'
  | 'one-time'

export type Flow = 'income' | 'expense'

export interface Account {
  id: string
  name: string
  /** Current balance in the app's base currency. */
  balance: number
  /** ISO date the balance was last known accurate. */
  asOf: string
}

/** A planned, repeating income or expense — the backbone of the forecast. */
export interface RecurringItem {
  id: string
  label: string
  /** Always a positive number; `flow` decides the sign. */
  amount: number
  flow: Flow
  cadence: Cadence
  category: string
  /** ISO date the item starts applying. */
  startDate: string
  /** Optional ISO date the item stops (exclusive). */
  endDate?: string
  /** For monthly+ cadences, the day of month it lands (1–31). */
  dayOfMonth?: number
  /** Section the line belongs to in the planner (e.g. "Fixed monthly"). Drives subtotals. */
  group?: string
  /**
   * Explicit per-month amounts (YYYY-MM → amount). When a month is present
   * here it overrides the cadence-derived value, letting a line vary month to
   * month exactly like a spreadsheet. Months absent fall back to `amount`/cadence.
   */
  monthly?: Record<string, number>
  notes?: string
}

/** An actual, observed transaction imported from a statement or added by hand. */
export interface Transaction {
  id: string
  /** ISO date (YYYY-MM-DD). */
  date: string
  description: string
  /** Signed: negative = money out, positive = money in. */
  amount: number
  category: string
  source: 'csv' | 'pdf' | 'manual'
  accountId?: string
  /** Denormalised YYYY-MM for fast monthly grouping. */
  month: string
}

export interface Goal {
  id: string
  label: string
  target: number
  saved: number
  targetDate?: string
}

export interface Settings {
  /** Anthropic API key — stored on-device only, never synced to GitHub. */
  apiKey: string
  model: string
  currency: string
  locale: string
  /** Display name used to personalise the assistant. */
  name?: string
  /** Google OAuth Client ID for optional Drive backup (stored on-device). */
  googleClientId?: string
  /** Drive file id of the backup, once created. */
  driveFileId?: string
}

export interface AppData {
  version: number
  settings: Settings
  accounts: Account[]
  recurring: RecurringItem[]
  transactions: Transaction[]
  goals: Goal[]
  /** Planned monthly spend per category (the "plan" money dates compare against). */
  categoryBudgets: Record<string, number>
  updatedAt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ── Derived / view models ─────────────────────────────────────────

export interface ForecastPoint {
  month: string // YYYY-MM
  label: string // e.g. "Jun"
  income: number
  expenses: number
  /** Expense split: fixed = through Imprevistos; variable = everything after. */
  fixedExpenses: number
  variableExpenses: number
  net: number
  /** Projected end-of-month total balance across all accounts. */
  balance: number
  /** True once the month is in the future (projection vs. settled). */
  projected: boolean
}

export interface CategoryActual {
  category: string
  flow: Flow
  planned: number
  actual: number
  variance: number // actual - planned (signed in plain terms)
}

export interface MonthReview {
  month: string
  income: number
  expenses: number
  net: number
  plannedIncome: number
  plannedExpenses: number
  plannedNet: number
  categories: CategoryActual[]
  transactionCount: number
}
