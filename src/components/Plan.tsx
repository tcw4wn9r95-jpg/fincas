import { useMemo, useState } from 'react'
import { useData } from '../store'
import { formatMoney, formatMonthLabel, todayISO, uid, classNames, currentMonth, addMonths, parseAmount } from '../lib/format'
import {
  accountBalance,
  isPlannedSetAside,
  itemAmountForMonth,
  nextOccurrence,
  cardActivity,
  cardPaymentTarget,
  isCardAccount,
  startingBalance,
  totalBalance,
  trackedAccountName,
} from '../lib/forecast'
import { CARD_PAYMENT_CATEGORY } from '../lib/categorize'
import { allProvisionStatuses, dropAllocations, emergencyFundStatus } from '../lib/provisions'
import { fundingPlan, potsCheck, type FundingLine } from '../lib/funding'
import { CATEGORIES } from '../lib/categorize'
import type { Account, Goal, Provision } from '../lib/types'
import { Planner } from './Planner'
import { IconPlus, IconTrash, IconCheck } from './icons'

/**
 * What a provision can be for: a bill. Income is what funds one, and the
 * transfer categories are how money moves between your own accounts — a pot
 * filed under either would read every salary or transfer as its bill being
 * paid, through `provisionRoleFor`.
 */
const PROVISION_CATS = CATEGORIES.filter(
  (c) => c !== 'Income' && c !== 'Internal' && c !== 'Transfer' && c !== 'Savings' && c !== 'Investments',
)

function Section({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div className="card p-6">
      <h3 className="text-lg">{title}</h3>
      <p className="text-sm text-muted mb-4">{desc}</p>
      {children}
    </div>
  )
}

/** One thing to save for, and this month's share of it. */
function FundingRow({
  line,
  fx,
  locale,
}: {
  line: FundingLine
  fx: (n: number) => string
  locale: string
}) {
  const due = line.dueDate
    ? new Date(line.dueDate + 'T00:00:00').toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null
  // Only lines still on schedule reach this row — a passed date drops out of the
  // transfer entirely, so 'due-now' is as urgent as it gets here.
  const urgent = line.status === 'due-now'
  return (
    <div
      className={classNames(
        'flex items-center gap-3 rounded-lg border px-4 py-3',
        urgent ? 'border-gold/50 bg-gold/5' : 'border-line bg-canvas',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{line.label}</span>
          {line.kind === 'event' && <span className="pill bg-forest-tint text-forest">event</span>}
          {line.eventLabel && (
            <span className="pill bg-forest-tint text-forest" title={`The fund for ${line.eventLabel}`}>
              event fund
            </span>
          )}
        </div>
        <div className="text-xs text-muted">
          {line.status === 'due-now' && <span className="text-ink">Due {due} · </span>}
          {line.status === 'on-track' && due && <span>Due {due} · </span>}
          {fx(line.remaining)} still to find
          {line.monthsLeft && line.monthsLeft > 1 ? ` over ${line.monthsLeft} months` : ' — all of it now'}
        </div>
      </div>
      <div className="tabular-nums text-right shrink-0">{fx(line.amount)}</div>
    </div>
  )
}

export function Plan() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fx = (n: number) => formatMoney(n, currency, locale)

  // ── Accounts ──
  // What was recorded, against where the forecast actually starts. They differ
  // whenever a balance is older than the start of this month — or newer, when
  // one was typed part-way through it.
  const recorded = totalBalance(data)
  const opening = startingBalance(data)
  const rolled = data.accounts.length > 0 && Math.abs(opening - recorded) > 0.5
  // Left over from before a card payment had to say which card it settles —
  // or from picking one that got deleted since. Each one is money the debt
  // above is quietly missing.
  const cardAccounts = useMemo(() => data.accounts.filter(isCardAccount), [data.accounts])
  const unaimedPayments = useMemo(
    () =>
      cardAccounts.length > 1
        ? data.transactions.filter(
            (t) => t.category === CARD_PAYMENT_CATEGORY && cardPaymentTarget(data, t) === undefined,
          )
        : [],
    [data, cardAccounts.length],
  )
  const [acct, setAcct] = useState({ name: '', balance: '' })
  /**
   * `kind` decides what the typed figure means: for cash it is what the account
   * holds, for a card it is what you owe today — stored negative, since a debt
   * is negative money and every total in the app can then just add up.
   */
  function addAccount(kind: 'cash' | 'card' = 'cash') {
    if (!acct.name.trim()) return
    const typed = parseAmount(acct.balance) || 0
    const a: Account = {
      id: uid(),
      name: acct.name.trim(),
      balance: kind === 'card' ? -Math.abs(typed) : typed,
      asOf: todayISO(),
      ...(kind === 'card' ? { kind } : {}),
    }
    update((d) => {
      d.accounts.push(a)
      return d
    })
    setAcct({ name: '', balance: '' })
  }
  /**
   * Create the account that follows the current-account statements, before any
   * statement has been imported. Months imported before this existed left no
   * balance behind, so without this the only way to get one is to wait for next
   * month's statement.
   */
  function addTrackedAccount() {
    update((d) => {
      if (d.accounts.some((a) => a.tracked)) return d
      d.accounts.push({ id: uid(), name: trackedAccountName, balance: 0, asOf: '', tracked: true })
      return d
    })
  }
  function removeAccount(id: string) {
    update((d) => {
      d.accounts = d.accounts.filter((a) => a.id !== id)
      return d
    })
  }
  function editAccount(id: string, fields: Partial<Account>) {
    update((d) => {
      const a = d.accounts.find((x) => x.id === id)
      if (a) Object.assign(a, fields)
      return d
    })
  }

  // ── Goals ──
  const [goal, setGoal] = useState({ label: '', target: '', saved: '' })
  function addGoal() {
    if (!goal.label.trim() || !parseAmount(goal.target)) return
    const g: Goal = {
      id: uid(),
      label: goal.label.trim(),
      target: parseAmount(goal.target) || 0,
      saved: parseAmount(goal.saved) || 0,
    }
    update((d) => {
      d.goals.push(g)
      return d
    })
    setGoal({ label: '', target: '', saved: '' })
  }
  function removeGoal(id: string) {
    update((d) => {
      d.goals = d.goals.filter((g) => g.id !== id)
      return d
    })
  }

  // ── Provisions ──
  const [prov, setProv] = useState({
    label: '',
    category: 'Taxes' as string,
    target: '',
    dueDate: '',
    startDate: '',
  })
  const provisionStatuses = useMemo(() => allProvisionStatuses(data), [data])
  const openProvisions = useMemo(() => provisionStatuses.filter((p) => !p.closedAt), [provisionStatuses])
  const closedProvisions = useMemo(
    () =>
      provisionStatuses
        .filter((p) => p.closedAt)
        .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')),
    [provisionStatuses],
  )
  const [showClosed, setShowClosed] = useState(false)

  /**
   * Plan lines worth saving up for: an expense the plan already carries, not
   * already claimed by a pot. Lines that are themselves a set-aside are left
   * out — provisioning your savings line is just the same money twice — and
   * the lumpy cadences come first, since a €900 premium once a year is what a
   * provision is actually for.
   */
  const CADENCE_RANK: Record<string, number> = { annual: 0, quarterly: 1, 'one-time': 2, biweekly: 3, weekly: 4, monthly: 5 }
  const provisionableLines = useMemo(() => {
    const claimed = new Set(data.provisions.map((p) => p.plannedLineId).filter(Boolean))
    return data.recurring
      .filter((r) => r.flow === 'expense' && !isPlannedSetAside(r) && !claimed.has(r.id))
      .sort(
        (a, b) =>
          (CADENCE_RANK[a.cadence] ?? 9) - (CADENCE_RANK[b.cadence] ?? 9) || b.amount - a.amount,
      )
  }, [data.recurring, data.provisions])

  /** Start a pot for a plan line, with its own figures already filled in. */
  function provisionFromLine(id: string) {
    const item = data.recurring.find((r) => r.id === id)
    if (!item) return
    const due = nextOccurrence(item)
    const target = due ? itemAmountForMonth(item, due.slice(0, 7)) : item.amount
    update((d) => {
      d.provisions.push({
        id: uid(),
        label: item.label,
        category: (PROVISION_CATS as readonly string[]).includes(item.category) ? item.category : 'Provisions',
        targetAmount: Math.round((target || item.amount) * 100) / 100,
        dueDate: due,
        createdAt: todayISO(),
        plannedLineId: item.id,
      })
      return d
    })
  }

  function addProvision() {
    if (!prov.label.trim() || !parseAmount(prov.target)) return
    const p: Provision = {
      id: uid(),
      label: prov.label.trim(),
      category: prov.category,
      targetAmount: parseAmount(prov.target) || 0,
      dueDate: prov.dueDate || undefined,
      // Left blank, a provision starts the day it is created.
      startDate: prov.startDate || undefined,
      createdAt: todayISO(),
    }
    update((d) => {
      d.provisions.push(p)
      return d
    })
    setProv({ label: '', category: 'Taxes', target: '', dueDate: '', startDate: '' })
  }
  function removeProvision(id: string) {
    update((d) => {
      d.provisions = d.provisions.filter((p) => p.id !== id)
      for (const t of d.transactions) {
        dropAllocations(t, (a) => a.provisionId === id)
      }
      return d
    })
  }
  /** Used for its purpose and put away — its history stays, it just stops asking for money. */
  function closeProvision(id: string) {
    update((d) => {
      const p = d.provisions.find((x) => x.id === id)
      if (p) p.closedAt = todayISO()
      return d
    })
  }
  function reopenProvision(id: string) {
    update((d) => {
      const p = d.provisions.find((x) => x.id === id)
      if (p) p.closedAt = undefined
      return d
    })
  }
  // ── Money to move into savings ──
  const [fundingMonth, setFundingMonth] = useState(() => addMonths(currentMonth(), 1))
  const funding = useMemo(
    () => fundingPlan(data, fundingMonth, todayISO()),
    [data, fundingMonth],
  )

  // ── Do the pots add up? ──
  const pots = useMemo(() => potsCheck(data), [data])
  function setProvisionAccount(id: string) {
    update((d) => {
      d.provisionAccountId = id || undefined
      return d
    })
  }

  // ── Emergency fund ──
  // Only the target is stored; the balance is whatever transactions have been
  // allocated to it, so it can't drift from what actually happened.
  const emergency = useMemo(() => emergencyFundStatus(data), [data])
  function setEmergencyTarget(targetAmount: number) {
    update((d) => {
      d.emergencyFund = { targetAmount: Math.max(0, targetAmount) }
      return d
    })
  }

  function editProvision(id: string, fields: Partial<Provision>) {
    update((d) => {
      const p = d.provisions.find((x) => x.id === id)
      if (!p) return d
      Object.assign(p, fields)
      // A category change can invalidate which linked transactions are the
      // real bill (drawdown) vs. money set aside for it (contribution) — any
      // drawdown that no longer matches the new category is unlinked rather
      // than left silently wrong; contributions are untouched.
      if (fields.category) {
        for (const t of d.transactions) {
          if (t.category === p.category) continue
          dropAllocations(t, (a) => a.provisionId === id && a.role === 'drawdown')
        }
      }
      return d
    })
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h2 className="text-2xl">Your plan</h2>
        <p className="text-muted">
          Starting balances, your full monthly plan, and goals — all editable
        </p>
      </div>

      <Section
        title="Accounts"
        desc="Where your money sits, and what you owe. An account whose statements carry a running balance keeps itself current — every import moves it on. A card works the other way round: its charges are spending the day they happen, so what you owe is worked out from those charges less every card payment, and paying the bill closes the gap instead of costing you twice."
      >
        {unaimedPayments.length > 0 && (
          <div className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 mb-4 text-sm">
            <p className="font-medium">
              {unaimedPayments.length} card payment{unaimedPayments.length === 1 ? '' : 's'} not
              saying which card{unaimedPayments.length === 1 ? '' : 's'}
            </p>
            <p className="text-muted mt-0.5">
              With more than one card, a payment has to name the one it settles or it pays off
              none of them — the debt above is missing {fx(unaimedPayments.reduce((s, t) => s + Math.abs(t.amount), 0))}
              {' '}because of these. Open the money date for{' '}
              {Array.from(new Set(unaimedPayments.map((t) => t.month)))
                .sort()
                .map((m) => formatMonthLabel(m, locale))
                .join(', ')}{' '}
              and pick a card on each.
            </p>
          </div>
        )}
        <div className="space-y-2 mb-4">
          {data.accounts.map((a) => {
            const awaiting = a.tracked && !a.asOf
            const card = isCardAccount(a)
            // A card's figure is worked out from its charges and the payments
            // that settled them, so it is shown rather than typed.
            const owed = card ? -accountBalance(data, a) : 0
            const activity = card ? cardActivity(data, a) : null
            return (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg bg-canvas px-4 py-2.5 border border-line"
              >
                <div className="flex-1 min-w-0">
                  <input
                    className="bg-transparent font-medium outline-none w-full focus:text-forest"
                    defaultValue={a.name}
                    onBlur={(e) => editAccount(a.id, { name: e.target.value.trim() || a.name })}
                  />
                  <div className="text-[11px] text-muted">
                    {card
                      ? activity && (activity.charged > 0.005 || activity.paid > 0.005)
                        ? `since ${formatMonthLabel(a.asOf, locale)}: ${fx(activity.charged)} charged − ${fx(activity.paid)} paid`
                        : `owed since ${formatMonthLabel(a.asOf, locale)} — nothing charged or paid yet`
                      : a.tracked
                        ? awaiting
                          ? 'waiting for its first current-account statement'
                          : `closing balance from your statement, ${a.asOf}`
                        : `as of ${formatMonthLabel(a.asOf, locale)}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {card ? (
                    <span
                      className={classNames(
                        'text-right tabular-nums w-32 shrink-0',
                        owed > 0.5 ? 'text-clay' : 'text-muted',
                      )}
                      title="What you owe: everything charged to this card, less every card payment"
                    >
                      {owed > 0.005
                        ? `${fx(owed)} owed`
                        : owed < -0.005
                          ? `${fx(-owed)} in credit`
                          : fx(0)}
                    </span>
                  ) : a.tracked ? (
                    <span
                      className="text-right tabular-nums w-32 shrink-0"
                      title="Written by your statements — import a month and it moves itself"
                    >
                      {awaiting ? '—' : fx(a.balance)}
                    </span>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="bg-transparent text-right outline-none tabular-nums w-32 focus:text-forest"
                      defaultValue={a.balance}
                      onBlur={(e) =>
                        editAccount(a.id, { balance: parseAmount(e.target.value) || 0, asOf: todayISO() })
                      }
                    />
                  )}
                  <button className="text-muted hover:text-clay" onClick={() => removeAccount(a.id)}>
                    <IconTrash width={16} height={16} />
                  </button>
                </div>
              </div>
            )
          })}
          {data.accounts.length === 0 && (
            <p className="text-sm text-muted">
              No accounts yet. Until there is one, nothing records what you hold,
              so the forecast can only show what comes in and goes out.
            </p>
          )}
        </div>
        {!data.accounts.some((a) => a.tracked) && (
          <div className="rounded-lg border border-line bg-canvas px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted max-w-lg">
              Let {trackedAccountName} keep itself current: it takes the closing
              balance off every current-account statement you import, so you
              never type it.
            </p>
            <button className="btn-subtle shrink-0" onClick={addTrackedAccount}>
              <IconPlus width={16} height={16} /> Track {trackedAccountName}
            </button>
          </div>
        )}
        {rolled && (
          <div className="rounded-lg bg-forest-tint/50 border border-line px-4 py-2.5 mb-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">
              Where {formatMonthLabel(currentMonth(), locale)} started
              {opening > recorded
                ? ', carrying what you recorded forward through your plan'
                : ', with the days that balance already covers taken back out'}
            </span>
            <span className="font-medium tabular-nums shrink-0">
              {fx(opening)}
              <span className="text-muted font-normal"> (from {fx(recorded)})</span>
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[160px]"
            placeholder="Account name"
            value={acct.name}
            onChange={(e) => setAcct({ ...acct, name: e.target.value })}
          />
          <input
            className="input w-40"
            type="text"
            inputMode="decimal"
            placeholder="Balance"
            value={acct.balance}
            onChange={(e) => setAcct({ ...acct, balance: e.target.value })}
          />
          <button className="btn-primary" onClick={() => addAccount('cash')}>
            <IconPlus width={16} height={16} /> Add
          </button>
          <button
            className="btn-subtle"
            onClick={() => addAccount('card')}
            title="A credit card is a debt: charges are spending the day they happen, and paying the bill closes the gap rather than costing you again"
          >
            <IconPlus width={16} height={16} /> Add as card
          </button>
        </div>
      </Section>

      <Planner />

      <Section title="Goals" desc="Track progress toward what you're saving for.">
        <div className="space-y-3 mb-4">
          {data.goals.map((g) => {
            const pct = Math.min(100, Math.round((g.saved / g.target) * 100))
            return (
              <div key={g.id} className="rounded-lg bg-canvas px-4 py-3 border border-line">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{g.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted tabular-nums">
                      {fx(g.saved)} / {fx(g.target)}
                    </span>
                    <button className="text-muted hover:text-clay" onClick={() => removeGoal(g.id)}>
                      <IconTrash width={16} height={16} />
                    </button>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-line overflow-hidden">
                  <div
                    className={classNames(
                      'h-full rounded-full',
                      pct >= 100 ? 'bg-forest' : 'bg-sage',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
          {data.goals.length === 0 && <p className="text-sm text-muted">No goals yet.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[140px]"
            placeholder="Goal (e.g. Emergency fund)"
            value={goal.label}
            onChange={(e) => setGoal({ ...goal, label: e.target.value })}
          />
          <input
            className="input w-28"
            type="text"
            inputMode="decimal"
            placeholder="Target"
            value={goal.target}
            onChange={(e) => setGoal({ ...goal, target: e.target.value })}
          />
          <input
            className="input w-28"
            type="text"
            inputMode="decimal"
            placeholder="Saved"
            value={goal.saved}
            onChange={(e) => setGoal({ ...goal, saved: e.target.value })}
          />
          <button className="btn-primary" onClick={addGoal}>
            <IconPlus width={16} height={16} /> Add
          </button>
        </div>
      </Section>

      <Section
        title="Provisions"
        desc="Set money aside ahead of a known bill — like a company provisioning for taxes — so it's already covered when the bill lands."
      >
        <div className="space-y-3 mb-4">
          {openProvisions.map((p) => (
            <div key={p.id} className="rounded-lg bg-canvas px-4 py-3 border border-line">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <input
                  className="bg-transparent font-medium outline-none w-full min-w-0 focus:text-forest"
                  defaultValue={p.label}
                  placeholder="Untitled provision"
                  onBlur={(e) => editProvision(p.id, { label: e.target.value.trim() || p.label })}
                />
                {p.plannedLineId && (
                  <span
                    className="pill bg-forest-tint text-forest shrink-0"
                    title={`Saving up for "${data.recurring.find((r) => r.id === p.plannedLineId)?.label ?? 'a plan line'}" in your plan`}
                  >
                    from plan
                  </span>
                )}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="text-muted hover:text-forest"
                    onClick={() => closeProvision(p.id)}
                    title="Used for its purpose — close it and move it out of the way"
                    aria-label={`Close ${p.label}`}
                  >
                    <IconCheck width={16} height={16} />
                  </button>
                  <button
                    className="text-muted hover:text-clay"
                    onClick={() => removeProvision(p.id)}
                    aria-label="Delete provision"
                  >
                    <IconTrash width={16} height={16} />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <select
                  className="input py-1 w-auto text-xs shrink-0"
                  value={p.category}
                  onChange={(e) => editProvision(p.id, { category: e.target.value })}
                >
                  {PROVISION_CATS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm text-muted tabular-nums">{fx(p.funded)} /</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="bg-transparent text-right outline-none tabular-nums w-20 focus:text-forest text-sm"
                    defaultValue={p.targetAmount}
                    onBlur={(e) =>
                      editProvision(p.id, { targetAmount: parseAmount(e.target.value) || p.targetAmount })
                    }
                  />
                </div>
              </div>
              <div className="h-2 rounded-full bg-line overflow-hidden">
                <div
                  className={classNames('h-full rounded-full', p.pct >= 100 ? 'bg-forest' : 'bg-sage')}
                  style={{ width: `${p.pct}%` }}
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-1.5 flex-wrap">
                <span>from</span>
                <input
                  type="date"
                  className="bg-transparent outline-none focus:text-forest"
                  aria-label={`When ${p.label} starts saving`}
                  defaultValue={p.startDate.slice(0, 10)}
                  onChange={(e) => editProvision(p.id, { startDate: e.target.value || undefined })}
                />
                <span>· due</span>
                <input
                  type="date"
                  className="bg-transparent outline-none focus:text-forest"
                  aria-label={`When ${p.label} is due`}
                  defaultValue={p.dueDate ?? ''}
                  onChange={(e) => editProvision(p.id, { dueDate: e.target.value || undefined })}
                />
                {p.suggestedMonthly ? (
                  <span>
                    · ≈{fx(p.suggestedMonthly)}/mo{' '}
                    {p.notStarted ? 'once it starts' : 'to stay on track'}
                  </span>
                ) : null}
              </div>
              {p.overdrawn > 0.5 && (
                <div className="text-xs text-clay mt-1">
                  Drawn {fx(p.overdrawn)} more than ever set aside — that shortfall came from elsewhere.
                </div>
              )}
            </div>
          ))}
          {openProvisions.length === 0 && (
            <p className="text-sm text-muted">
              {closedProvisions.length > 0
                ? 'Nothing active — add one for an upcoming bill below, or reopen a closed one.'
                : 'No provisions yet — add one for an upcoming bill below.'}
            </p>
          )}
        </div>
        {provisionableLines.length > 0 && (
          <div className="mb-3 rounded-lg border border-line bg-canvas px-4 py-3">
            <div className="text-sm font-medium">Save up for something already in your plan</div>
            <p className="text-xs text-muted mt-0.5 mb-2">
              Pick a planned cost and it starts a pot with that line's amount and the date it next lands —
              so an annual premium is put by month by month instead of landing whole.
            </p>
            <select
              className="input w-full sm:w-auto"
              value=""
              onChange={(e) => e.target.value && provisionFromLine(e.target.value)}
            >
              <option value="">Choose a plan line…</option>
              {provisionableLines.map((r) => {
                const due = nextOccurrence(r)
                return (
                  <option key={r.id} value={r.id}>
                    {r.label} · {fx(r.amount)} {r.cadence}
                    {due ? ` · next ${formatMonthLabel(due, locale)}` : ''}
                  </option>
                )
              })}
            </select>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[140px]"
            placeholder="Provision (e.g. Quarterly tax)"
            value={prov.label}
            onChange={(e) => setProv({ ...prov, label: e.target.value })}
          />
          <select
            className="input w-auto"
            value={prov.category}
            onChange={(e) => setProv({ ...prov, category: e.target.value })}
          >
            {PROVISION_CATS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="input w-28"
            type="text"
            inputMode="decimal"
            placeholder="Target"
            value={prov.target}
            onChange={(e) => setProv({ ...prov, target: e.target.value })}
          />
          {/* Native date inputs take no placeholder, so each carries its own
              word — two bare date boxes side by side say nothing. */}
          <label className="input w-auto flex items-center gap-2 text-xs text-muted">
            from
            <input
              className="bg-transparent outline-none text-sm text-ink"
              type="date"
              aria-label="When this provision starts saving (defaults to today)"
              value={prov.startDate}
              onChange={(e) => setProv({ ...prov, startDate: e.target.value })}
            />
          </label>
          <label className="input w-auto flex items-center gap-2 text-xs text-muted">
            due
            <input
              className="bg-transparent outline-none text-sm text-ink"
              type="date"
              aria-label="When this provision is due"
              value={prov.dueDate}
              onChange={(e) => setProv({ ...prov, dueDate: e.target.value })}
            />
          </label>
          <button className="btn-primary" onClick={addProvision}>
            <IconPlus width={16} height={16} /> Add
          </button>
        </div>

        {closedProvisions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <button
              className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5"
              onClick={() => setShowClosed((s) => !s)}
            >
              <span className={classNames('transition-transform text-[10px]', showClosed && 'rotate-90')}>▶</span>
              Closed provisions ({closedProvisions.length})
            </button>
            {showClosed && (
              <div className="space-y-2 mt-3">
                {closedProvisions.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg bg-canvas px-4 py-3 border border-line flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.label}</div>
                      <div className="text-xs text-muted">
                        {p.category} · {fx(p.funded)} of {fx(p.targetAmount)} funded · closed {p.closedAt}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button className="btn-subtle text-xs" onClick={() => reopenProvision(p.id)}>
                        Reopen
                      </button>
                      <button
                        className="text-muted hover:text-clay"
                        onClick={() => removeProvision(p.id)}
                        aria-label="Delete provision"
                      >
                        <IconTrash width={16} height={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Move to savings"
        desc="One transfer that keeps every provision and upcoming event on schedule. Anything due that month asks for its whole remaining balance — there's no later month to spread it into. Once a date has passed it stops asking; there's no catch-up tab."
      >
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <div className="label">Move for {formatMonthLabel(fundingMonth + '-01', locale)}</div>
            <div className="stat-value tabular-nums">{fx(funding.total)}</div>
          </div>
          <div className="grid grid-cols-2 gap-1 p-1 bg-canvas rounded-xl border border-line">
            {[currentMonth(), addMonths(currentMonth(), 1)].map((m, i) => (
              <button
                key={m}
                onClick={() => setFundingMonth(m)}
                className={classNames(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  fundingMonth === m ? 'bg-forest text-paper' : 'text-muted hover:text-ink',
                )}
              >
                {i === 0 ? 'This month' : 'Next month'}
              </button>
            ))}
          </div>
        </div>

        {funding.lines.length === 0 &&
          funding.undated.length === 0 &&
          funding.lapsed.length === 0 &&
          funding.notYet.length === 0 && (
          <p className="text-sm text-muted">
            Nothing to move — every provision and event is funded for that month.
          </p>
          )}
        {funding.lines.length === 0 &&
          (funding.undated.length > 0 || funding.lapsed.length > 0 || funding.notYet.length > 0) && (
            <p className="text-sm text-muted">Nothing on schedule to fund that month.</p>
          )}

        <div className="space-y-2">
          {funding.lines.map((l) => (
            <FundingRow key={l.id} line={l} fx={fx} locale={locale} />
          ))}
        </div>

        {funding.undated.length > 0 && (
          <div className="mt-4 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
            <div className="text-sm font-medium">Not counted — no date set</div>
            <p className="text-xs text-muted mt-0.5">
              Without a due date there's no way to know how fast to save. Add one and these join the
              transfer.
            </p>
            <div className="mt-2 space-y-1">
              {funding.undated.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{l.label}</span>
                  <span className="tabular-nums text-muted shrink-0">{fx(l.remaining)} short</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {funding.notYet.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-canvas/60 px-4 py-3">
            <div className="text-sm font-medium text-muted">Not yet — they start later</div>
            <p className="text-xs text-muted mt-0.5">
              These join the transfer in the month they start, and spread what they need over the
              months they have from there.
            </p>
            <div className="mt-2 space-y-1">
              {funding.notYet.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-muted">{l.label}</span>
                  <span className="tabular-nums text-muted shrink-0">
                    {fx(l.remaining)} from{' '}
                    {l.startDate ? formatMonthLabel(l.startDate.slice(0, 7), locale) : 'later'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {funding.lapsed.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-canvas/60 px-4 py-3">
            <div className="text-sm font-medium text-muted">Date passed — no longer counted</div>
            <p className="text-xs text-muted mt-0.5">
              These stopped asking for money when their date went by. If one is still coming, give
              it a new date and it rejoins the transfer.
            </p>
            <div className="mt-2 space-y-1">
              {funding.lapsed.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-muted">{l.label}</span>
                  <span className="tabular-nums text-muted shrink-0">
                    {fx(l.remaining)} never set aside
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {funding.settled.length > 0 && (
          <p className="text-xs text-muted mt-3">
            {funding.settled.length} already fully funded:{' '}
            {funding.settled.map((l) => l.label).join(', ')}.
          </p>
        )}
      </Section>

      <Section
        title="Emergency fund"
        desc="The catch-all pot. When you provision a transaction, whatever isn't earmarked for a named bill can be swept in here — so spare cash lands somewhere deliberate instead of disappearing."
      >
        <div className="rounded-lg bg-canvas px-4 py-3 border border-line">
          <div className="flex items-end justify-between gap-3 mb-2">
            <div>
              <div className="label">Saved</div>
              <div className="stat-value tabular-nums">{fx(emergency.balance)}</div>
            </div>
            <div className="text-right">
              <label className="label" htmlFor="emergency-target">
                Target
              </label>
              <input
                id="emergency-target"
                type="text"
                inputMode="decimal"
                className="bg-transparent text-right outline-none tabular-nums w-28 focus:text-forest"
                placeholder="0"
                defaultValue={emergency.targetAmount || ''}
                onBlur={(e) => setEmergencyTarget(parseAmount(e.target.value) || 0)}
              />
            </div>
          </div>
          {emergency.targetAmount > 0 && (
            <>
              <div className="h-2 rounded-full bg-line overflow-hidden">
                <div
                  className={classNames(
                    'h-full rounded-full',
                    emergency.pct >= 100 ? 'bg-forest' : 'bg-sage',
                  )}
                  style={{ width: `${emergency.pct}%` }}
                />
              </div>
              <div className="text-xs text-muted mt-1.5">
                {emergency.pct}% of target
                {emergency.balance < emergency.targetAmount
                  ? ` · ${fx(emergency.targetAmount - emergency.balance)} to go`
                  : ' · fully funded'}
              </div>
            </>
          )}
          {emergency.targetAmount === 0 && (
            <p className="text-xs text-muted">
              Set a target to track progress — the balance builds up either way.
            </p>
          )}
          <div className="text-xs text-muted mt-2 tabular-nums">
            {fx(emergency.contributed)} paid in · {fx(emergency.drawn)} taken out
          </div>
          {emergency.overdrawn > 0.5 && (
            <div className="text-xs text-clay mt-1">
              Taken out {fx(emergency.overdrawn)} more than ever paid in — that came from elsewhere.
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Do the pots add up?"
        desc="Every pot balance here is worked out from what you allocated, which keeps them consistent with each other but proves nothing about the money being there. This compares what they claim against the account you actually transfer into."
      >
        <div className="mb-4">
          <label className="label" htmlFor="pots-account">
            Account holding the pots
          </label>
          <select
            id="pots-account"
            className="input w-auto"
            value={pots.accountId ?? ''}
            onChange={(e) => setProvisionAccount(e.target.value)}
          >
            <option value="">Not set</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {data.accounts.length === 0 ? (
          <p className="text-sm text-muted">Add an account above and this check comes to life.</p>
        ) : pots.difference === null ? (
          <p className="text-sm text-muted">
            Pick the account you move money into when provisioning — the pots currently claim{' '}
            <span className="tabular-nums text-ink">{fx(pots.total)}</span>.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-lg bg-canvas px-4 py-3 border border-line">
                <div className="label">The pots claim</div>
                <div className="text-xl tabular-nums">{fx(pots.total)}</div>
                <div className="text-xs text-muted mt-0.5 tabular-nums">
                  {fx(pots.provisions)} in provisions · {fx(pots.emergency)} emergency fund
                </div>
              </div>
              <div className="rounded-lg bg-canvas px-4 py-3 border border-line">
                <div className="label">{pots.accountName} holds</div>
                <div className="text-xl tabular-nums">{fx(pots.accountBalance ?? 0)}</div>
                <div className="text-xs text-muted mt-0.5">
                  {pots.asOf ? `as you last recorded it, ${pots.asOf}` : 'no date recorded'}
                </div>
              </div>
            </div>
            {Math.abs(pots.difference) < 1 ? (
              <div className="rounded-lg border border-forest/40 bg-forest-tint/40 px-4 py-3 text-sm">
                <span className="font-medium text-forest">In step.</span> The account holds what the
                pots say it should.
              </div>
            ) : pots.difference > 0 ? (
              <div className="rounded-lg border border-gold/50 bg-gold/5 px-4 py-3 text-sm">
                <span className="font-medium">
                  {fx(pots.difference)} in {pots.accountName} isn't claimed by any pot.
                </span>
                <p className="text-xs text-muted mt-0.5">
                  Either it belongs to a pot you haven't allocated to yet, or it's spare — worth
                  giving it a job so it isn't quietly idle.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-clay/50 bg-clay/5 px-4 py-3 text-sm">
                <span className="font-medium text-clay">
                  The pots promise {fx(-pots.difference)} more than {pots.accountName} holds.
                </span>
                <p className="text-xs text-muted mt-0.5">
                  Often just money in flight: moved back to your main account for a bill you haven't
                  paid yet, so the pot still counts it. Otherwise a transfer never happened, a pot
                  was funded twice, or something was spent without being drawn from its pot.
                </p>
              </div>
            )}
            <p className="text-xs text-muted mt-2">
              Only as current as the balance you recorded for {pots.accountName} — update it above
              before trusting a difference.
            </p>
          </>
        )}
      </Section>
    </div>
  )
}
