import { Fragment, useMemo, useState } from 'react'
import { useData } from '../store'
import {
  computeReview,
  cardPaymentTarget,
  isCardAccount,
  monthsWithData,
  actualsByCategory,
  itemAmountForMonth,
  spendSeriesByCategory,
  streak,
} from '../lib/forecast'
import { formatMoney, formatMonthLabel, shortMonth, classNames, currentMonth, addMonths, uid, txMatchKey, todayISO } from '../lib/format'
import { eventsInMonth } from '../lib/events'
import { fundingPlan } from '../lib/funding'
import { CARD_PAYMENT_CATEGORY, CATEGORIES, NON_CASHFLOW, withRule } from '../lib/categorize'
import { aiCategorize, hasApiKey, streamTransactionAdvice } from '../lib/claude'
import { buildSankey, describeSankeyFlow } from '../lib/sankey'
import {
  allProvisionStatuses,
  emergencyFundStatus,
  provisionCoveredByCategory,
  setAsideAmount,
  setAsideBucket,
  type ProvisionStatus,
} from '../lib/provisions'
import type { Account, ProvisionAllocation, Transaction } from '../lib/types'
import { CardPicker } from './CardPicker'
import { ImportModal } from './ImportModal'
import { RuleModal } from './RuleModal'
import { ReconcileOverlay } from './ReconcileOverlay'
import { ProvisionButton, ProvisionModal } from './ProvisionModal'
import { Sparkline } from './Sparkline'
import { SankeyChart } from './SankeyChart'
import { SankeyOverlay } from './SankeyOverlay'
import { IconUpload, IconChat, IconTag, IconCheck, IconTrash } from './icons'

function VarianceBar({ planned, actual }: { planned: number; actual: number }) {
  const max = Math.max(planned, actual, 1)
  return (
    <div className="space-y-1 min-w-[120px]">
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div className="h-full bg-forest/30" style={{ width: `${(planned / max) * 100}%` }} />
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div
          className={classNames('h-full', actual > planned ? 'bg-clay' : 'bg-sage')}
          style={{ width: `${(actual / max) * 100}%` }}
        />
      </div>
    </div>
  )
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface TrendRow {
  cat: string
  vals: number[]
  current: number
  prev: number
  delta: number
  run: number
}

export function MoneyDate({
  onDiscuss,
  onGoToEvents,
  onGoToPlan,
}: {
  onDiscuss: (month: string) => void
  onGoToEvents: () => void
  onGoToPlan: () => void
}) {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const [importing, setImporting] = useState(false)
  const [applied, setApplied] = useState('')
  // Which category row is expanded to fix its transactions, and any row being
  // turned into a rule.
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [teaching, setTeaching] = useState<Transaction | null>(null)
  // The transaction whose provision split is open. Held here (not inside the
  // reconcile overlay) so the pop-up stacks above whichever view opened it.
  const [provisioning, setProvisioning] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')

  // The picker always offers the current month and the previous six, so you can
  // back-fill and review recent months (e.g. all of July on Aug 7) even before
  // any statement is imported — plus any older months you already have data for.
  const months = useMemo(() => {
    const set = new Set(monthsWithData(data))
    for (let i = 0; i <= 6; i++) set.add(addMonths(currentMonth(), -i))
    return Array.from(set).sort().reverse()
  }, [data])
  // Null until the user picks explicitly: the view then follows the newest month
  // that has data (so a fresh July import shows straight away), while a manual
  // pick sticks.
  const [month, setMonth] = useState<string | null>(null)
  const activeMonth =
    month && months.includes(month) ? month : monthsWithData(data)[0] ?? currentMonth()

  const review = useMemo(() => computeReview(data, activeMonth), [data, activeMonth])
  const provisionStatuses = useMemo(() => allProvisionStatuses(data), [data])
  const emergency = useMemo(() => emergencyFundStatus(data), [data])
  const monthEvents = useMemo(
    () => eventsInMonth(data, activeMonth, todayISO()),
    [data, activeMonth],
  )
  // Anchored to today, not to the month being reviewed: the transfer is an
  // action you take now, and browsing back to March shouldn't ask you to fund
  // April against balances that have since moved on.
  const nextMonthFunding = useMemo(
    () => fundingPlan(data, addMonths(currentMonth(), 1), todayISO()),
    [data],
  )
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, opts)

  const [sankeyOpen, setSankeyOpen] = useState(false)
  const { sankeyGraph, sankeyInsights } = useMemo(() => {
    const { income, expense, setAside } = actualsByCategory(data, activeMonth, { splitSavings: true })
    const covered = provisionCoveredByCategory(data, activeMonth)
    return {
      sankeyGraph: buildSankey(income, expense, covered, setAside),
      sankeyInsights: describeSankeyFlow(income, expense, covered, currency, locale, setAside),
    }
  }, [data, activeMonth, currency, locale])

  // This month's transactions grouped by category (both signs together, so a
  // category with spends and refunds shows them all when expanded).
  const txByCatKey = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of data.transactions) {
      if (t.month !== activeMonth) continue
      const list = map.get(t.category)
      if (list) list.push(t)
      else map.set(t.category, [t])
    }
    return map
  }, [data, activeMonth])

  // Everything the totals deliberately leave out: transfers between your own
  // accounts, and card payments — which settle spending already charged in the
  // month it happened, so counting them here would charge it twice.
  const internalTxs = useMemo(
    () =>
      Array.from(txByCatKey.entries())
        .filter(([cat]) => NON_CASHFLOW.has(cat))
        .flatMap(([, list]) => list),
    [txByCatKey],
  )
  const cardAccounts = useMemo(() => data.accounts.filter(isCardAccount), [data.accounts])
  const cardPaymentTotal = useMemo(
    () =>
      internalTxs
        .filter((t) => t.category === CARD_PAYMENT_CATEGORY)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [internalTxs],
  )

  const monthTxs = useMemo(
    () => data.transactions.filter((t) => t.month === activeMonth),
    [data, activeMonth],
  )
  const reconciledCount = monthTxs.filter((t) => t.reconciled).length
  // The carry-over is offered only once the month is actually closed —
  // sweeping a surplus mid-month would be moving money you haven't finished
  // spending.
  // Resolved from the store by id, so the pop-up always edits live data.
  const provisioningTx = provisioning
    ? data.transactions.find((t) => t.id === provisioning) ?? null
    : null

  // Reconciling one line reconciles every line that is the same recurring item
  // — same description AND amount — in this month and every other, with the same
  // category. Decide a recurring line once; the copies (and next month's) settle
  // themselves. Same wording but a different amount stays independent.
  function setReconciled(id: string, reconciled: boolean) {
    update((d) => {
      const t = d.transactions.find((x) => x.id === id)
      if (!t) return d
      const key = txMatchKey(t.description, t.amount)
      const category = t.category
      for (const x of d.transactions) {
        if (txMatchKey(x.description, x.amount) !== key) continue
        x.reconciled = reconciled
        if (reconciled) x.category = category
      }
      return d
    })
  }
  function reconcileAllSuggestions() {
    update((d) => {
      for (const t of d.transactions) {
        // The same gate the OK button applies: a card payment nobody has aimed
        // settles nothing, so bulk-confirming it would quietly wave through a
        // line that isn't actually doing what its category claims.
        const needsCard = t.category === CARD_PAYMENT_CATEGORY && cardPaymentTarget(d, t) === undefined
        if (t.month === activeMonth && !t.reconciled && t.category !== 'Other' && !needsCard) {
          const key = txMatchKey(t.description, t.amount)
          const category = t.category
          for (const x of d.transactions) {
            if (txMatchKey(x.description, x.amount) === key) {
              x.reconciled = true
              x.category = category
            }
          }
        }
      }
      return d
    })
  }
  // Categorise the not-yet-reconciled lines with Claude, primed on the user's
  // whole history, then leave them as suggestions to confirm.
  async function runAiCategorize() {
    const targets = monthTxs.filter((t) => !t.reconciled)
    if (!targets.length || aiBusy) return
    setAiBusy(true)
    setAiError('')
    try {
      const result = await aiCategorize(data, targets)
      if (result.size) {
        update((d) => {
          for (const t of d.transactions) {
            const c = result.get(t.id)
            if (c) t.category = c
          }
          return d
        })
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI categorisation failed.')
    } finally {
      setAiBusy(false)
    }
  }

  /** Aim a card payment at the card it settles — only asked when there are several. */
  function setTxCard(id: string, cardAccountId: string | undefined) {
    update((d) => {
      const t = d.transactions.find((x) => x.id === id)
      if (t) t.cardAccountId = cardAccountId
      return d
    })
  }

  function deleteMonth() {
    const samples = (data.sampleTransactions ?? []).filter((t) => t.month === activeMonth).length
    const what =
      `${monthTxs.length} transaction${monthTxs.length === 1 ? '' : 's'}` +
      (samples > 0 ? ` and ${samples} weekly check-in line${samples === 1 ? '' : 's'}` : '')
    if (
      !confirm(
        `Delete all ${what} for ${formatMonthLabel(activeMonth, locale)}? This can't be undone.`,
      )
    )
      return
    update((d) => {
      d.transactions = d.transactions.filter((t) => t.month !== activeMonth)
      // The weekly pulse holds its own sample of the same month. Leaving it
      // behind is how a month you deleted keeps turning up.
      d.sampleTransactions = (d.sampleTransactions ?? []).filter((t) => t.month !== activeMonth)
      return d
    })
  }

  // Changing a category re-files every line that is the same recurring item
  // (same description AND amount) — so identical lines follow, but a same-worded
  // line with a different amount is left alone. For a broad "any line like this"
  // rule, use the tag (Teach) button instead.
  function setTxCategory(id: string, category: string) {
    update((d) => {
      const t = d.transactions.find((x) => x.id === id)
      if (!t) return d
      const key = txMatchKey(t.description, t.amount)
      for (const x of d.transactions) {
        // Provision allocations survive: the category is what the money was
        // for, the allocation is which pot it moved through, and their
        // direction is now chosen by hand rather than read off the category —
        // so re-filing a line no longer says anything about where its money
        // came from.
        if (txMatchKey(x.description, x.amount) === key) x.category = category
      }
      return d
    })
  }

  // Save one transaction's provision split. Unlike category, this is
  // instance-specific — it doesn't propagate to matching lines. The legacy
  // single-link fields are cleared alongside so the two never disagree about
  // what this transaction funds.
  function setTxAllocations(id: string, allocations: ProvisionAllocation[]) {
    update((d) => {
      const t = d.transactions.find((x) => x.id === id)
      if (!t) return d
      t.provisionAllocations = allocations.length ? allocations.map((a) => ({ ...a, amount: round2(a.amount) })) : undefined
      t.provisionId = undefined
      t.provisionRole = undefined
      t.provisionAmount = undefined
      return d
    })
  }

  // Teach a rule from a saved transaction: remember it and re-file every saved
  // line that matches, so the whole "Other" pile can be cleaned in one go.
  function saveRule(match: string, category: string) {
    const m = match.trim()
    if (m) {
      const needle = m.toLowerCase()
      update((d) => {
        d.categoryRules = withRule(d.categoryRules, uid(), m, category)
        for (const t of d.transactions) {
          if (t.description.toLowerCase().includes(needle)) t.category = category
        }
        return d
      })
    }
    setTeaching(null)
  }

  const netVsPlan = review.net - review.plannedNet
  const incomeRows = review.categories.filter((c) => c.flow === 'income')
  const expenseRows = review.categories.filter((c) => c.flow === 'expense')

  // The headline of a money date: the two or three places the month actually
  // went off plan, before the full table. A category already pre-funded by a
  // provision (e.g. a quarterly tax bill saved for in advance) shouldn't read
  // as a shock, so its provision-covered amount is netted out of the variance
  // used here — the raw totals in the table below stay untouched.
  const provisionNetVariance = (c: (typeof expenseRows)[number]) => c.variance - (c.provisionCovered ?? 0)
  const overPlan = expenseRows
    .filter((c) => provisionNetVariance(c) > 5)
    .sort((a, b) => provisionNetVariance(b) - provisionNetVariance(a))
    .slice(0, 3)
  const underPlan = expenseRows
    .filter((c) => c.variance < -5)
    .sort((a, b) => a.variance - b.variance)
    .slice(0, 2)

  // Money kept, broken into what it was kept for. These transactions never
  // appear as a category row above — their net is zero, since the money never
  // left the accounts this balance covers — so they get their own section
  // instead, shown only for a bucket that actually moved.
  const setAsideRows = useMemo(() => {
    const buckets: Array<{ key: 'provisions' | 'investments' | 'savings'; label: string; planned: number; actual: number }> = [
      { key: 'provisions', label: 'Provisions', planned: review.plannedSetAsideProvisions, actual: review.setAsideProvisions },
      { key: 'investments', label: 'Investments', planned: review.plannedSetAsideInvestments, actual: review.setAsideInvestments },
      { key: 'savings', label: 'Savings', planned: review.plannedSetAsideSavings, actual: review.setAsideSavings },
    ]
    return buckets
      .filter((b) => Math.abs(b.planned) > 0.5 || Math.abs(b.actual) > 0.5)
      .map((b) => ({
        ...b,
        txs: monthTxs.filter((t) => setAsideAmount(t) !== 0 && setAsideBucket(t) === b.key),
      }))
  }, [review, monthTxs])

  // Closing the loop: how far this month's plan still differs from its actuals,
  // over the categories that actually have transactions.
  const reconcileGap = useMemo(() => {
    const { income, expense } = actualsByCategory(data, activeMonth)
    let gap = 0
    for (const [cat, actual] of Object.entries(expense)) {
      const planned = data.recurring
        .filter((r) => r.flow === 'expense' && r.category === cat)
        .reduce((s, r) => s + itemAmountForMonth(r, activeMonth), 0)
      gap += Math.abs(actual - planned)
    }
    for (const [cat, actual] of Object.entries(income)) {
      const planned = data.recurring
        .filter((r) => r.flow === 'income' && r.category === cat)
        .reduce((s, r) => s + itemAmountForMonth(r, activeMonth), 0)
      gap += Math.abs(actual - planned)
    }
    return gap
  }, [data, activeMonth])
  const inSync = reconcileGap < 1

  // Month-over-month trends: actual spend per category across recent months.
  const trends = useMemo(() => {
    const hist = monthsWithData(data)
      .filter((m) => m <= activeMonth)
      .sort()
      .slice(-6)
    if (hist.length < 2) return { months: hist as string[], rows: [] as TrendRow[], streaks: [] as TrendRow[] }
    const series = spendSeriesByCategory(data, hist)
    const rows: TrendRow[] = Object.entries(series).map(([cat, vals]) => {
      const current = vals[vals.length - 1]
      const prev = vals[vals.length - 2]
      return { cat, vals, current, prev, delta: current - prev, run: streak(vals) }
    })
    rows.sort((a, b) => b.current - a.current)
    const streaks = rows
      .filter((r) => Math.abs(r.run) >= 3 && r.current > 5)
      .sort((a, b) => Math.abs(b.run) - Math.abs(a.run))
    return { months: hist, rows: rows.filter((r) => r.current > 0).slice(0, 8), streaks }
  }, [data, activeMonth])

  // Overwrite this month's plan values with the imported actuals, category by
  // category — so the plan (and the forecast that rolls through it) reflects
  // what actually happened. Multi-line categories scale proportionally.
  function matchPlanToActuals() {
    if (
      !confirm(
        `Replace your plan's ${formatMonthLabel(activeMonth, locale)} amounts with the imported actuals? Only this month changes; you can still edit any line afterwards.`,
      )
    )
      return
    update((d) => {
      const { income, expense } = actualsByCategory(d, activeMonth)
      const apply = (map: Record<string, number>, flow: 'income' | 'expense') => {
        for (const [cat, actual] of Object.entries(map)) {
          const lines = d.recurring.filter((r) => r.flow === flow && r.category === cat)
          if (!lines.length) continue
          const planned = lines.reduce((s, l) => s + itemAmountForMonth(l, activeMonth), 0)
          if (lines.length === 1 || planned <= 0) {
            lines[0].monthly = { ...(lines[0].monthly ?? {}), [activeMonth]: round2(actual) }
            for (let i = 1; i < lines.length; i++) {
              lines[i].monthly = { ...(lines[i].monthly ?? {}), [activeMonth]: 0 }
            }
          } else {
            for (const l of lines) {
              const cur = itemAmountForMonth(l, activeMonth)
              l.monthly = { ...(l.monthly ?? {}), [activeMonth]: round2((cur * actual) / planned) }
            }
          }
        }
      }
      apply(income, 'income')
      apply(expense, 'expense')
      return d
    })
    setApplied(activeMonth)
    setTimeout(() => setApplied(''), 3000)
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-2xl">Money date</h2>
            {monthTxs.length > 0 &&
              (reconciledCount === monthTxs.length ? (
                <span className="pill bg-forest text-paper inline-flex items-center gap-1">
                  <IconCheck width={13} height={13} /> Reconciled
                </span>
              ) : (
                <span className="pill bg-gold/15 text-ink/70">
                  {reconciledCount}/{monthTxs.length} reconciled
                </span>
              ))}
          </div>
          <p className="text-muted">Where you actually stand vs. your plan</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            className="input w-auto"
            value={activeMonth}
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m, locale)}
              </option>
            ))}
          </select>
          {monthTxs.length > 0 && (
            <button className="btn-ghost" onClick={() => setReconciling(true)}>
              <IconCheck width={16} height={16} /> Reconcile
            </button>
          )}
          <button className="btn-ghost" onClick={() => onDiscuss(activeMonth)}>
            <IconChat width={16} height={16} /> Discuss
          </button>
          <button className="btn-primary" onClick={() => setImporting(true)}>
            <IconUpload width={16} height={16} /> Import statement
          </button>
          {monthTxs.length > 0 && (
            <button
              className="btn-subtle p-2 text-muted hover:text-clay"
              onClick={deleteMonth}
              title={`Delete ${formatMonthLabel(activeMonth, locale)} data`}
              aria-label="Delete this month's data"
            >
              <IconTrash width={16} height={16} />
            </button>
          )}
        </div>
      </div>

      {monthTxs.length > 0 && reconciledCount < monthTxs.length && (
        <button
          onClick={() => setReconciling(true)}
          className="card w-full p-4 flex items-center gap-4 text-left hover:shadow-lift transition"
        >
          <span className="w-10 h-10 rounded-xl bg-forest text-paper grid place-items-center shrink-0">
            <IconCheck width={20} height={20} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-medium">
              Reconcile {monthTxs.length - reconciledCount} transaction
              {monthTxs.length - reconciledCount === 1 ? '' : 's'}
            </span>
            <span className="block text-sm text-muted">
              Confirm or correct each — the app learns, so next month there's less to do
            </span>
          </span>
          <span className="text-sm text-muted tabular-nums shrink-0">
            {reconciledCount}/{monthTxs.length}
          </span>
        </button>
      )}

      {review.transactionCount === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-muted max-w-md mx-auto">
            No transactions for {formatMonthLabel(activeMonth, locale)} yet. Import a CSV or
            PDF statement to start your money date.
          </p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setImporting(true)}>
            <IconUpload width={16} height={16} /> Import statement
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="card p-5">
              <div className="label">Money in</div>
              <div className="stat-value text-forest">{fx(review.income)}</div>
              <div className="text-sm text-muted mt-1">
                planned {fx(review.plannedIncome)}
              </div>
            </div>
            <div className="card p-5">
              <div className="label">Money out</div>
              <div className="stat-value text-clay">{fx(review.expenses)}</div>
              <div className="text-sm text-muted mt-1">
                planned {fx(review.plannedExpenses)}
              </div>
              {review.provisionedSpend > 0.5 && (
                <div className="text-xs text-muted mt-1">
                  plus {fx(review.provisionedSpend)} of bills your provisions paid — charged to the
                  months that funded them
                </div>
              )}
            </div>
            {/* Kept, not spent — a provision transfer is a different kind of
                event from a grocery run, and reads wrong lumped in with one. */}
            <div className="card p-5">
              <div className="label">Set aside</div>
              <div className="stat-value text-gold">{fx(review.setAside)}</div>
              <div className="text-sm text-muted mt-1">
                {review.plannedSetAside > 0
                  ? `planned ${fx(review.plannedSetAside)}`
                  : 'into provisions & savings'}
              </div>
              {setAsideRows.length > 1 && (
                <div className="text-xs text-muted mt-1.5 pt-1.5 border-t border-line">
                  {setAsideRows.map((r) => `${fx(r.actual)} ${r.label.toLowerCase()}`).join(' · ')}
                </div>
              )}
            </div>
            {/* Two nets, because they answer different questions: what the
                month left behind, and how the month itself went once the pots
                — which only move money between pockets — are set aside. */}
            <div className="card p-5">
              <div className="label">Net result</div>
              <div
                className={classNames(
                  'stat-value',
                  review.net >= 0 ? 'text-forest' : 'text-clay',
                )}
              >
                {fx(review.net, { signed: true })}
              </div>
              <div
                className={classNames(
                  'text-sm mt-1',
                  netVsPlan >= 0 ? 'text-forest' : 'text-clay',
                )}
              >
                {fx(netVsPlan, { signed: true })} vs plan
              </div>
              {review.setAside > 0.5 && (
                <div className="mt-2.5 pt-2.5 border-t border-line">
                  <div className="text-xs text-muted">Before setting aside</div>
                  <div
                    className={classNames(
                      'tabular-nums font-medium text-lg leading-tight',
                      review.netBeforeSetAside >= 0 ? 'text-forest' : 'text-clay',
                    )}
                  >
                    {fx(review.netBeforeSetAside, { signed: true })}
                  </div>
                  <p className="text-[11px] text-muted leading-snug mt-1">
                    What the month earned over what you lived on, before you committed{' '}
                    {fx(review.setAside)} of it to future bills.
                  </p>
                </div>
              )}
            </div>
          </div>

          {sankeyGraph.nodes.length > 0 && (
            <button
              className="card p-6 w-full text-left hover:shadow-lift transition"
              onClick={() => setSankeyOpen(true)}
            >
              <h3 className="text-lg mb-1">Where it went</h3>
              <p className="text-sm text-muted mb-4">
                Money in and where it went, {formatMonthLabel(activeMonth, locale)} · tap for details
              </p>
              <SankeyChart graph={sankeyGraph} currency={currency} locale={locale} />
            </button>
          )}

          {/* The one action that leaves the month: fund next month's provisions. */}
          {nextMonthFunding.total > 0 && (
            <div className="card p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg">Move to savings</h3>
                <p className="text-sm text-muted">
                  Keep {formatMonthLabel(nextMonthFunding.month + '-01', locale)}'s provisions
                  {nextMonthFunding.lines.some((l) => l.kind === 'event') ? ' and events' : ''} on
                  schedule — {nextMonthFunding.lines.length} thing
                  {nextMonthFunding.lines.length === 1 ? '' : 's'} to cover.
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="stat-value tabular-nums">{fx(nextMonthFunding.total)}</div>
                <button className="btn-subtle text-xs" onClick={onGoToPlan}>
                  See the breakdown
                </button>
              </div>
            </div>
          )}

          {/* Close the loop: make the plan (and forecast) reflect what happened */}
          <div className="card p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg">Close the loop</h3>
              <p className="text-sm text-muted">
                {applied === activeMonth
                  ? `Plan updated for ${formatMonthLabel(activeMonth, locale)} — your forecast now builds on these actuals.`
                  : inSync
                    ? `Your plan for ${formatMonthLabel(activeMonth, locale)} already matches these actuals.`
                    : `Match your plan for ${formatMonthLabel(activeMonth, locale)} to what actually happened, so the forecast builds on reality.`}
              </p>
            </div>
            {applied === activeMonth || inSync ? (
              <span className="pill bg-forest-tint text-forest shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-sage" /> In sync
              </span>
            ) : (
              <button className="btn-primary shrink-0" onClick={matchPlanToActuals}>
                Match plan to actuals
              </button>
            )}
          </div>

          {monthEvents.length > 0 && (
            <div className="card p-5">
              <h3 className="text-lg">How the events went</h3>
              <p className="text-sm text-muted mb-3">
                Budgeted separately, so a trip doesn't just read as a bad month.
              </p>
              <div className="space-y-3">
                {monthEvents.map((e) => (
                  <button
                    key={e.id}
                    className="w-full text-left rounded-lg border border-line bg-canvas px-4 py-3 hover:bg-forest-tint/40 transition"
                    onClick={onGoToEvents}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="font-medium truncate">{e.label}</span>
                      <span
                        className={classNames('text-sm tabular-nums shrink-0', e.over && 'text-clay')}
                      >
                        {fx(e.spent)} of {fx(e.budget)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-line overflow-hidden">
                      <div
                        className={classNames('h-full rounded-full', e.over ? 'bg-clay' : 'bg-forest')}
                        style={{ width: `${Math.min(100, e.pct)}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted mt-1.5">
                      {e.over ? `${fx(-e.remaining)} over budget` : `${fx(e.remaining)} under budget`}
                      {e.pendingCount > 0 && ` · ${e.pendingCount} logged line${e.pendingCount === 1 ? '' : 's'} still to confirm`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(overPlan.length > 0 || underPlan.length > 0) && (
            <div className="card p-5">
              <h3 className="text-lg mb-3">Where it went off plan</h3>
              <div className="flex flex-wrap gap-2">
                {overPlan.map((c) => (
                  <span key={c.category} className="pill bg-clay/10 text-clay">
                    {c.category} {fx(provisionNetVariance(c))} over
                  </span>
                ))}
                {underPlan.map((c) => (
                  <span key={c.category} className="pill bg-forest-tint text-forest">
                    {c.category} {fx(Math.abs(c.variance))} under
                  </span>
                ))}
              </div>
            </div>
          )}

          {trends.months.length >= 2 && trends.rows.length > 0 && (
            <div className="card p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-lg">Trends</h3>
                <span className="text-xs text-muted">
                  actual spend · {shortMonth(trends.months[0], locale)}–
                  {shortMonth(trends.months[trends.months.length - 1], locale)}
                </span>
              </div>

              {trends.streaks.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  {trends.streaks.slice(0, 3).map((r) => {
                    const rising = r.run > 0
                    return (
                      <div key={r.cat} className="flex items-center gap-2 text-sm">
                        <span className={rising ? 'text-clay' : 'text-forest'}>
                          {rising ? '▲' : '▼'}
                        </span>
                        <span className="text-ink">
                          <span className="font-medium">{r.cat}</span>{' '}
                          {rising ? 'up' : 'down'} {Math.abs(r.run)} months in a row
                        </span>
                        <span className="text-muted tabular-nums">
                          {fx(r.vals[r.vals.length - Math.abs(r.run) - 1] ?? r.prev)} → {fx(r.current)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
                {trends.rows.map((r) => {
                  const up = r.delta > 0.5
                  const down = r.delta < -0.5
                  return (
                    <div key={r.cat} className="flex items-center gap-3 py-1">
                      <span className="text-sm text-ink w-24 truncate">{r.cat}</span>
                      <Sparkline values={r.vals} color={up ? '#b95f38' : '#2e5347'} />
                      <span className="ml-auto text-sm tabular-nums text-ink">{fx(r.current)}</span>
                      <span
                        className={classNames(
                          'text-xs tabular-nums w-14 text-right',
                          up ? 'text-clay' : down ? 'text-forest' : 'text-muted',
                        )}
                      >
                        {up ? '▲' : down ? '▼' : '–'}{' '}
                        {r.prev > 0 ? `${Math.round((r.delta / r.prev) * 100)}%` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-6 pt-5 pb-2">
              <h3 className="text-lg">By category</h3>
              <p className="text-sm text-muted">
                Tap a category to see and re-file its transactions ·{' '}
                <span className="text-clay">red</span> means over plan
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-y border-line">
                    <th className="px-6 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium">Plan vs actual</th>
                    <th className="px-4 py-2.5 font-medium text-right">Planned</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actual</th>
                    <th className="px-6 py-2.5 font-medium text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {[...incomeRows, ...expenseRows].map((c) => {
                    // For expenses, spending more than planned is "bad" (clay).
                    // For income, earning less than planned is "bad" (clay).
                    // A category already covered by a provision nets that
                    // amount out first — a fully pre-funded bill shouldn't
                    // read as an overdraft just because there was no plan
                    // line for it.
                    const provisionCovered = c.provisionCovered ?? 0
                    const effVariance = c.flow === 'expense' ? c.variance - provisionCovered : c.variance
                    const unfavourable =
                      c.flow === 'expense' ? effVariance > 0.5 : c.variance < -0.5
                    const label =
                      c.flow === 'income'
                        ? c.variance >= 0
                          ? 'above'
                          : 'below'
                        : effVariance > 0.5
                          ? 'over'
                          : effVariance < -0.5
                            ? 'under'
                            : provisionCovered > 0
                              ? 'prefunded'
                              : 'on plan'
                    const displayVariance = c.flow === 'expense' ? effVariance : c.variance
                    const key = `${c.flow}-${c.category}`
                    const txs = txByCatKey.get(c.category) ?? []
                    const isOpen = openCat === c.category
                    return (
                      <Fragment key={key}>
                        <tr
                          className={classNames(
                            'border-b border-line/60',
                            txs.length > 0 && 'cursor-pointer hover:bg-canvas/50',
                          )}
                          onClick={() => txs.length > 0 && setOpenCat(isOpen ? null : c.category)}
                        >
                          <td className="px-6 py-3">
                            <span className="inline-flex items-center gap-1.5">
                              {txs.length > 0 && (
                                <span
                                  className={classNames(
                                    'text-muted transition-transform text-[10px]',
                                    isOpen && 'rotate-90',
                                  )}
                                >
                                  ▶
                                </span>
                              )}
                              <span
                                className={classNames(
                                  'pill',
                                  c.flow === 'income'
                                    ? 'bg-forest-tint text-forest'
                                    : 'bg-clay/10 text-clay',
                                )}
                              >
                                {c.category}
                              </span>
                              {txs.length > 0 && (
                                <span className="text-xs text-muted">{txs.length}</span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <VarianceBar planned={c.planned} actual={c.actual} />
                          </td>
                          <td className="px-4 py-3 text-right text-muted">{fx(c.planned)}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {fx(c.actual)}
                            {!!c.provisionCovered && (
                              <div className="text-[11px] text-muted font-normal">
                                prefunded {fx(c.provisionCovered)}
                              </div>
                            )}
                          </td>
                          <td
                            className={classNames(
                              'px-6 py-3 text-right font-medium',
                              unfavourable ? 'text-clay' : 'text-forest',
                            )}
                          >
                            {fx(Math.abs(displayVariance), { signed: false })}
                            <span className="text-xs ml-1 text-muted">{label}</span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={5} className="p-0 border-b border-line/60">
                              <DrillList
                                txs={txs}
                                currency={currency}
                                locale={locale}
                                provisions={provisionStatuses}
                                onSet={setTxCategory}
                                onSetCard={setTxCard}
                                cards={cardAccounts}
                                onTeach={setTeaching}
                                onProvision={(t) => setProvisioning(t.id)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}

                  {setAsideRows.map((r) => {
                    const variance = r.actual - r.planned
                    const unfavourable = variance < -0.5
                    const label = r.planned > 0.5 ? (variance >= -0.5 ? 'above' : 'below') : undefined
                    const key = `setaside-${r.key}`
                    const isOpen = openCat === key
                    return (
                      <Fragment key={key}>
                        <tr
                          className={classNames(
                            'border-b border-line/60',
                            r.txs.length > 0 && 'cursor-pointer hover:bg-canvas/50',
                          )}
                          onClick={() => r.txs.length > 0 && setOpenCat(isOpen ? null : key)}
                        >
                          <td className="px-6 py-3">
                            <span className="inline-flex items-center gap-1.5">
                              {r.txs.length > 0 && (
                                <span
                                  className={classNames(
                                    'text-muted transition-transform text-[10px]',
                                    isOpen && 'rotate-90',
                                  )}
                                >
                                  ▶
                                </span>
                              )}
                              <span className="pill bg-forest-tint text-forest">{r.label}</span>
                              {r.txs.length > 0 && (
                                <span className="text-xs text-muted">{r.txs.length}</span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <VarianceBar planned={r.planned} actual={r.actual} />
                          </td>
                          <td className="px-4 py-3 text-right text-muted">{fx(r.planned)}</td>
                          <td className="px-4 py-3 text-right font-medium">{fx(r.actual)}</td>
                          <td
                            className={classNames(
                              'px-6 py-3 text-right font-medium',
                              label ? (unfavourable ? 'text-clay' : 'text-forest') : 'text-muted',
                            )}
                          >
                            {label ? (
                              <>
                                {fx(Math.abs(variance), { signed: false })}
                                <span className="text-xs ml-1 text-muted">{label}</span>
                              </>
                            ) : (
                              <span className="text-xs">kept, not spent</span>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={5} className="p-0 border-b border-line/60">
                              <DrillList
                                txs={r.txs}
                                currency={currency}
                                locale={locale}
                                provisions={provisionStatuses}
                                onSet={setTxCategory}
                                onSetCard={setTxCard}
                                cards={cardAccounts}
                                onTeach={setTeaching}
                                onProvision={(t) => setProvisioning(t.id)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}

                  {internalTxs.length > 0 && (
                    <Fragment>
                      <tr
                        className="border-b border-line/60 cursor-pointer hover:bg-canvas/50"
                        onClick={() => setOpenCat(openCat === 'internal' ? null : 'internal')}
                      >
                        <td className="px-6 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={classNames(
                                'text-muted transition-transform text-[10px]',
                                openCat === 'internal' && 'rotate-90',
                              )}
                            >
                              ▶
                            </span>
                            <span className="pill bg-line/60 text-muted">Not counted</span>
                            <span className="text-xs text-muted">{internalTxs.length}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted" colSpan={3}>
                          Money moved between your own accounts
                          {cardPaymentTotal > 0.5
                            ? `, and ${fx(cardPaymentTotal)} paid off your card — charged when you spent it, not when you settled the bill`
                            : ' — not counted'}
                        </td>
                        <td className="px-6 py-3 text-right text-muted tabular-nums">
                          {fx(review.excludedIn - review.excludedOut, { signed: true })}
                        </td>
                      </tr>
                      {openCat === 'internal' && (
                        <tr>
                          <td colSpan={5} className="p-0 border-b border-line/60">
                            <DrillList
                              txs={internalTxs}
                              currency={currency}
                              locale={locale}
                              provisions={provisionStatuses}
                              onSet={setTxCategory}
                              onSetCard={setTxCard}
                              cards={cardAccounts}
                              onTeach={setTeaching}
                              onProvision={(t) => setProvisioning(t.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          existing={data.transactions}
          replaceMonths
          onSaved={() => setReconciling(true)}
        />
      )}
      {teaching && (
        <RuleModal
          description={teaching.description}
          initialCategory={teaching.category}
          matchCount={(m) =>
            m.trim()
              ? data.transactions.filter((t) =>
                  t.description.toLowerCase().includes(m.trim().toLowerCase()),
                ).length
              : 0
          }
          onCancel={() => setTeaching(null)}
          onSave={saveRule}
        />
      )}
      {reconciling && (
        <ReconcileOverlay
          month={activeMonth}
          txs={monthTxs}
          currency={currency}
          locale={locale}
          provisions={provisionStatuses}
          cards={cardAccounts}
          onSetCard={setTxCard}
          onSetCategory={(id, category) => {
            setTxCategory(id, category)
            // Recategorising normally *is* the confirmation — that's why there's
            // no separate step for the common case. But filing something as
            // Other still needs a real category, and filing it as a card
            // payment while it can't yet resolve to a card would auto-confirm a
            // payment that settles nothing: the OK button blocks both, so
            // picking either from the dropdown must not skip around that gate.
            const t = data.transactions.find((x) => x.id === id)
            const needsCard =
              category === CARD_PAYMENT_CATEGORY && t && cardPaymentTarget(data, t) === undefined
            if (category !== 'Other' && !needsCard) setReconciled(id, true)
          }}
          onToggle={setReconciled}
          onConfirmAll={reconcileAllSuggestions}
          onAiCategorize={hasApiKey(data) ? runAiCategorize : undefined}
          onProvision={(t) => setProvisioning(t.id)}
          onAskAdvice={
            hasApiKey(data)
              ? (t, handlers) => void streamTransactionAdvice(data, t, handlers)
              : undefined
          }
          aiBusy={aiBusy}
          aiError={aiError}
          onClose={() => setReconciling(false)}
        />
      )}
      {provisioningTx && (
        <ProvisionModal
          tx={provisioningTx}
          provisions={provisionStatuses}
          emergency={emergency}
          currency={currency}
          locale={locale}
          onSave={(allocations) => setTxAllocations(provisioningTx.id, allocations)}
          onClose={() => setProvisioning(null)}
        />
      )}
      {sankeyOpen && (
        <SankeyOverlay
          graph={sankeyGraph}
          currency={currency}
          locale={locale}
          title="Where it went"
          subtitle={`Money in and where it went, ${formatMonthLabel(activeMonth, locale)}`}
          insights={sankeyInsights}
          onClose={() => setSankeyOpen(false)}
        />
      )}
    </div>
  )
}

/** The editable transaction list revealed under a category row. */
function DrillList({
  txs,
  currency,
  locale,
  provisions,
  cards,
  onSet,
  onSetCard,
  onTeach,
  onProvision,
}: {
  txs: Transaction[]
  currency: string
  locale: string
  provisions: ProvisionStatus[]
  onSet: (id: string, category: string) => void
  onSetCard: (id: string, cardAccountId: string | undefined) => void
  onTeach: (t: Transaction) => void
  onProvision: (t: Transaction) => void
  cards: Account[]
}) {
  return (
    <div className="bg-canvas/40 px-6 py-2 divide-y divide-line/50">
      {txs.map((t) => (
        <div key={t.id} className="flex items-center gap-2 py-2 text-sm">
          <span className="text-muted w-12 shrink-0 tabular-nums">{t.date.slice(5)}</span>
          <span className="flex-1 min-w-0 truncate" title={t.description}>
            {t.description}
          </span>
          <span
            className={classNames(
              'tabular-nums w-24 text-right shrink-0',
              t.amount >= 0 ? 'text-forest' : 'text-ink',
            )}
          >
            {formatMoney(t.amount, currency, locale, { signed: true })}
          </span>
          <select
            className="input py-1 w-32 shrink-0 text-xs"
            value={t.category}
            onChange={(e) => onSet(t.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <CardPicker tx={t} cards={cards} onPick={(c) => onSetCard(t.id, c)} compact />
          <ProvisionButton
            tx={t}
            provisions={provisions}
            currency={currency}
            locale={locale}
            onOpen={() => onProvision(t)}
            compact
          />
          <button
            className="text-muted hover:text-forest shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onTeach(t)
            }}
            title="Teach a rule from this line"
            aria-label="Teach a rule"
          >
            <IconTag width={15} height={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
