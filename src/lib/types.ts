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

export type AccountKind = 'cash' | 'card'

export interface Account {
  id: string
  name: string
  /**
   * Cash: what the account holds. Card: what was owed at `asOf` — the *opening*
   * figure only, since everything charged and paid since is derived from the
   * transactions themselves. Always read through `accountBalance()`.
   */
  balance: number
  /** ISO date the balance was last known accurate. Empty on a tracked account awaiting its first statement. */
  asOf: string
  /**
   * A card is a debt, not a pot of money: its balance is negative, it is never
   * an anchor for the forecast, and paying it off is a transfer rather than
   * spending. Absent means cash — every account written before cards existed.
   */
  kind?: AccountKind
  /**
   * The cardholder's name off a statement, normalised (trimmed, lower-cased)
   * for matching future imports back to this same card — kept apart from
   * `name` so renaming the account to something like "Maria's Visa" doesn't
   * stop the next statement for the same person from finding it again. Only
   * ever set by the PDF parser; never shown.
   */
  cardholderKey?: string
  /**
   * Balance is written by the closing figure on imported current-account
   * statements rather than typed, so it moves itself every time a month is
   * added. See `applyStatementBalance`.
   */
  tracked?: boolean
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
  /** Marked true once reviewed/confirmed in the reconcile flow. */
  reconciled?: boolean
  /**
   * Set when this row stands in for a plan line rather than recording something
   * observed: a fixed cost assumed paid at the start of the month, or a bill
   * ticked off by hand on "This month". Names the `RecurringItem` it came from,
   * so the statement that eventually carries the real charge can replace it
   * instead of counting alongside it.
   */
  plannedLineId?: string
  /**
   * How this transaction is split across provision buckets. One transaction
   * can feed several pots (a €1,000 transfer: €500 to taxes, €300 to the
   * car, €200 left unallocated), so this is a list, not a single link.
   * Read it through `transactionAllocations()` — never directly — so the
   * legacy single-link fields below still resolve.
   */
  provisionAllocations?: ProvisionAllocation[]
  /** Tags this transaction as spending that belongs to a special event. */
  eventId?: string
  /**
   * On a `Card payment` line: which card it settles. Left unset when there is
   * only one card, which is the ordinary case — `cardPaymentTarget()` resolves
   * it either way.
   */
  cardAccountId?: string
  /**
   * @deprecated Named the month a leftover-sweep transaction closed, back when
   * a money date offered to move what a month didn't spend into the emergency
   * fund. Retired: the sweep never moved real money — cash balances come only
   * from statements — so it only ever inflated the emergency fund's claimed
   * total without anything to show for it in the account meant to hold it.
   * Kept so a transaction written by that flow still reads; nothing sets it now.
   */
  carryoverFor?: string
  /** @deprecated Pre-split single link, kept so old data still reads. See `provisionAllocations`. */
  provisionId?: string
  /** @deprecated See `provisionAllocations`. */
  provisionRole?: 'contribution' | 'drawdown'
  /** @deprecated See `provisionAllocations`. */
  provisionAmount?: number
}

/**
 * One slice of a transaction earmarked for a provision bucket. `amount` is
 * always positive and never exceeds the transaction's own absolute amount
 * once summed across the list — the difference is what's still left to
 * allocate.
 */
export interface ProvisionAllocation {
  provisionId: string
  amount: number
  /**
   * Which way the money moved: into the pot, or out of it to pay for this.
   * Chosen when the allocation is made — the categories only seed a guess
   * (`provisionRoleFor`), since savings can pay for anything.
   */
  role: 'contribution' | 'drawdown'
}

export interface Goal {
  id: string
  label: string
  target: number
  saved: number
  targetDate?: string
}

/**
 * A sinking fund for a known upcoming expense (e.g. a quarterly tax bill) —
 * money set aside ahead of time so the real bill doesn't land as a shock.
 * `funded` is never stored here: it's derived from transactions tagged with
 * this provision's id via `provisionStatus()` in `lib/provisions.ts`.
 */
export interface Provision {
  id: string
  label: string
  /** The expense category this money is set aside to cover, e.g. "Taxes". */
  category: string
  targetAmount: number
  /** ISO date (or YYYY-MM) the provisioned expense is next expected. */
  dueDate?: string
  /**
   * When this pot starts asking for money. Before it, the pot is dormant: it
   * takes nothing from the monthly transfer and paces itself over the months
   * from here to `dueDate` rather than from today. Absent means it started the
   * day it was created — read it through `provisionStart()`, never directly.
   */
  startDate?: string
  createdAt: string
  /**
   * ISO date this provision was closed — used for its purpose and put away.
   * A closed provision drops out of the plan's active list and stops asking
   * for money, but its history stays intact and it can be reopened.
   */
  closedAt?: string
}

/**
 * One spend logged by hand while an event is happening — the running tally you
 * keep at the party, before any statement exists. It is deliberately NOT a
 * `Transaction`: it never touches the month's totals, because the statement
 * that arrives later is the real record. Once the matching line does arrive,
 * `matchedTxId` retires this one so the two can't both count.
 */
export interface EventExpense {
  id: string
  date: string
  label: string
  /** Positive: what was spent. */
  amount: number
  category: string
  matchedTxId?: string
}

export type EventKind = 'travel' | 'party' | 'other'

/**
 * A trip, a party, a wedding — spending that is planned as a lump, happens in a
 * burst, and is worth judging against its own budget rather than getting lost
 * inside a month. Money can be set aside for it ahead of time through a linked
 * provision, exactly like any other known upcoming expense.
 */
export interface SpecialEvent {
  id: string
  label: string
  kind: EventKind
  /** ISO dates; a single-day event has `endDate === startDate`. */
  startDate: string
  endDate: string
  budget: number
  /** The category its spending belongs to, e.g. "Travel". */
  category: string
  /** The sinking fund saving up for it, when one was created. */
  provisionId?: string
  /** Logged live during the event — see `EventExpense`. */
  expenses: EventExpense[]
  notes?: string
  createdAt: string
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
  /** Sinking funds for known upcoming expenses — see `Provision`. */
  provisions: Provision[]
  /**
   * The catch-all pot for money that isn't earmarked for any named bill.
   * Only the target lives here — the balance is derived from transaction
   * allocations, exactly like a provision (`emergencyFundStatus`).
   */
  emergencyFund?: { targetAmount: number }
  /** Trips, parties and the like, budgeted and tracked on their own — see `SpecialEvent`. */
  events?: SpecialEvent[]
  /**
   * The account the pots actually live in — the one money is transferred to
   * when provisioning. Lets the plan check what the pots claim to hold against
   * what is really sitting there.
   */
  provisionAccountId?: string
  /** Planned monthly spend per category (the "plan" money dates compare against). */
  categoryBudgets: Record<string, number>
  /** User-taught rules that override auto-categorisation on future imports. */
  categoryRules?: CategoryRule[]
  /** Saved what-if scenarios layered over the plan (on-device only). */
  scenarios?: Scenario[]
  /** The scenario currently overlaid on the forecast, if any. */
  activeScenarioId?: string
  /**
   * @deprecated The weekly check-in's own sample of variable spending, kept
   * apart from `transactions` so its Revolut export and the money date's full
   * statements never double-counted. Retired with that screen: "This month"
   * imports into `transactions` like everything else, and hand-logged spend
   * lives there too. Still read (events tag against it) so a file saved before
   * the change keeps showing what it already held; nothing writes it now.
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
  /** Planned provisioning: kept out of `expenses`, since it stays in the accounts. */
  setAside: number
  /** `setAside`, split by kind — the three always sum to it. */
  setAsideProvisions: number
  setAsideInvestments: number
  setAsideSavings: number
  /**
   * The change in total balance: income − expenses. Money set aside is *not*
   * subtracted — it stays in the accounts the balance covers, it just moves
   * pocket. This is what drives the balance line.
   */
  net: number
  /**
   * income − expenses − setAside: what the month actually gained or lost, once
   * money committed to future bills is counted as spoken for. The same figure
   * the money date calls "Net result", so the plan and the review agree.
   */
  netResult: number
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
  /** Portion of this month's actual already funded by a provision drawdown. */
  provisionCovered?: number
}

export interface MonthReview {
  month: string
  income: number
  /**
   * Ordinary spending: money put into provisions or savings is not in here,
   * and neither is a bill a provision paid for — that was charged in the
   * months that funded it.
   */
  expenses: number
  /** Money kept: paid into provisions, the emergency fund, or plain savings. */
  setAside: number
  /** `setAside`, split by kind — the three always sum to it. */
  setAsideProvisions: number
  setAsideInvestments: number
  setAsideSavings: number
  /** income − expenses − setAside: what the month actually gained or lost. */
  net: number
  /** The same figure before any money was committed to a pot. */
  netBeforeSetAside: number
  /** Spending this month that a provision had already paid for. */
  provisionedSpend: number
  plannedIncome: number
  plannedExpenses: number
  plannedSetAside: number
  /** `plannedSetAside`, split by kind — the three always sum to it. */
  plannedSetAsideProvisions: number
  plannedSetAsideInvestments: number
  plannedSetAsideSavings: number
  plannedNet: number
  categories: CategoryActual[]
  transactionCount: number
  /** Money moved between the user's own accounts (Internal), not counted in totals. */
  excludedIn: number
  excludedOut: number
}
