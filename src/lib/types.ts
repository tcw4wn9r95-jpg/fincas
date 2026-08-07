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
  /** User-taught rules that override auto-categorisation on future imports. */
  categoryRules?: CategoryRule[]
  /** Saved what-if scenarios layered over the plan (on-device only). */
  scenarios?: Scenario[]
  /** The scenario currently overlaid on the forecast, if any. */
  activeScenarioId?: string
  /**
   * Weekly check-in transactions — a sample of variable spending (e.g. a
   * Revolut export). Kept separate from `transactions` so the monthly money
   * date (full bank statements) and the weekly pulse never double-count.
   */
  sampleTransactions?: Transaction[]
  updatedAt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * A user-taught categorisation rule: any imported description containing
 * `match` (case-insensitive) is filed under `category`. Lets people explain
 * what their bank's cryptic lines actually are, and have it stick next time.
 */
export interface CategoryRule {
  id: string
  match: string
  category: string
}

// ── Scenarios ─────────────────────────────────────────────────────
// A scenario is a lightweight "what-if" layer over the base plan. It never
// changes the real plan — it's a named set of adjustments the forecast can be
// re-run through, so the user can overlay e.g. "Diana takes 3 more months off"
// against their baseline. Like all financial data it lives on-device only.

export type AdjustmentOp = 'scale' | 'set' | 'pause' | 'add'

export interface ScenarioAdjustment {
  id: string
  /** Existing recurring line this modifies. Omitted for a brand-new line (op 'add'). */
  targetId?: string
  op: AdjustmentOp
  /** scale: percent (120 = +20%). set/add: the monthly amount. pause: ignored. */
  value?: number
  /** Applies from this month (YYYY-MM) inclusive. Omitted = start of the plan. */
  from?: string
  /** Applies through this month (YYYY-MM) inclusive. Omitted = end of the plan. */
  to?: string
  /** For op 'add': the new line's identity. */
  newLine?: { label: string; flow: Flow; category: string }
}

export interface Scenario {
  id: string
  name: string
  adjustments: ScenarioAdjustment[]
  createdAt: string
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
  /** Money moved between the user's own accounts (Internal), not counted in totals. */
  excludedIn: number
  excludedOut: number
}
