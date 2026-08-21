import { useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../store'
import {
  computeMonthPulse,
  monthPulseText,
  autoPayTransactions,
  plannedPayment,
  type DuplicatePair,
  type PendingBill,
} from '../lib/month'
import { monthsWithData } from '../lib/forecast'
import { eventsInRange } from '../lib/events'
import { CATEGORIES, NON_CASHFLOW } from '../lib/categorize'
import {
  formatMoney,
  formatMonthLabel,
  classNames,
  currentMonth,
  addMonths,
  uid,
  todayISO,
  parseAmount,
} from '../lib/format'
import type { Transaction } from '../lib/types'
import { ImportModal } from './ImportModal'
import { IconUpload, IconChat, IconPlus, IconTrash, IconCheck } from './icons'

/** What you'd log by hand: money out, in a category you actually budget for. */
const QUICK_CATS = CATEGORIES.filter((c) => c !== 'Income' && !NON_CASHFLOW.has(c))

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: React.ReactNode
  tone?: 'default' | 'good' | 'warn'
}) {
  return (
    <div className="card p-5">
      <div className="label">{label}</div>
      <div
        className={classNames(
          'stat-value',
          tone === 'good' && 'text-forest',
          tone === 'warn' && 'text-clay',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </div>
  )
}

export function CurrentMonth({
  onDiscuss,
  onGoToEvents,
  onGoToPlan,
}: {
  onDiscuss: (prompt: string) => void
  onGoToEvents: () => void
  onGoToPlan: () => void
}) {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const [importing, setImporting] = useState(false)

  // The current month leads, but a month you're still filling in by hand is
  // often the one just gone — so recent months stay reachable.
  const months = useMemo(() => {
    const set = new Set<string>([currentMonth()])
    for (let i = 1; i <= 5; i++) set.add(addMonths(currentMonth(), -i))
    for (const m of monthsWithData(data)) set.add(m)
    return Array.from(set).sort().reverse()
  }, [data])
  const [month, setMonth] = useState<string | null>(null)
  const activeMonth = month && months.includes(month) ? month : currentMonth()

  const pulse = useMemo(() => computeMonthPulse(data, activeMonth), [data, activeMonth])
  const monthEvents = useMemo(
    () => eventsInRange(data, `${activeMonth}-01`, lastDayOf(activeMonth), todayISO()),
    [data, activeMonth],
  )
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, { round: true, ...opts })

  // ── Logging a spend by hand ──
  const [draft, setDraft] = useState({
    description: '',
    amount: '',
    category: 'Food' as string,
    date: todayISO(),
  })
  function addManual() {
    const amount = parseAmount(draft.amount)
    if (!draft.description.trim() || !amount) return
    // Typed into a "log a spend" box, a bare number means money out. Someone
    // recording a refund can still say so with a leading minus.
    const signed = draft.amount.trim().startsWith('-') ? Math.abs(amount) : -Math.abs(amount)
    const date = draft.date || todayISO()
    const t: Transaction = {
      id: uid(),
      date,
      description: draft.description.trim(),
      amount: signed,
      category: draft.category,
      source: 'manual',
      month: date.slice(0, 7),
      reconciled: true,
    }
    update((d) => {
      d.transactions.push(t)
      return d
    })
    setDraft({ description: '', amount: '', category: draft.category, date })
  }

  // Fixed costs leave whether or not anyone remembers them, so the month starts
  // with them already counted rather than listing them for a whole month
  // waiting to be ticked off. Written once per month: the rows satisfy the same
  // "has this line arrived" test that selected them, so this settles on the
  // next pass. Only ever for the month being lived in — browsing back to March
  // should not invent transactions in it.
  const autoPaidFor = useRef<string | null>(null)
  useEffect(() => {
    if (activeMonth !== currentMonth() || autoPaidFor.current === activeMonth) return
    const rows = autoPayTransactions(data, activeMonth)
    autoPaidFor.current = activeMonth
    if (!rows.length) return
    update((d) => {
      // Re-checked inside the update: two renders could otherwise each decide
      // the same bill was missing and write it twice.
      const already = new Set(
        d.transactions.filter((t) => t.month === activeMonth && t.plannedLineId).map((t) => t.plannedLineId),
      )
      d.transactions.push(...rows.filter((r) => !already.has(r.plannedLineId)))
      return d
    })
  }, [data, activeMonth, update])

  /** Tick a planned bill off by hand — the same row auto-pay would have written. */
  function markPaid(bill: PendingBill) {
    const item = data.recurring.find((r) => r.id === bill.id)
    if (!item) return
    const tx = plannedPayment(data, item, activeMonth)
    if (!tx) return
    update((d) => {
      d.transactions.push(tx)
      return d
    })
  }

  function removeTx(id: string) {
    update((d) => {
      d.transactions = d.transactions.filter((t) => t.id !== id)
      return d
    })
  }

  /** Resolve a duplicate by dropping one side; the other stays as the record. */
  function resolveDuplicate(pair: DuplicatePair, keep: 'imported' | 'manual') {
    update((d) => {
      const drop = keep === 'imported' ? pair.manual.id : pair.imported.id
      d.transactions = d.transactions.filter((t) => t.id !== drop)
      return d
    })
  }
  function keepBoth(pair: DuplicatePair) {
    // Nothing to change in the data — the pair simply stops being a pair once
    // the hand-logged line says it is deliberate.
    update((d) => {
      const t = d.transactions.find((x) => x.id === pair.manual.id)
      if (t) t.description = `${t.description} (confirmed separate)`
      return d
    })
  }

  function discuss() {
    onDiscuss(
      monthPulseText(data, activeMonth) +
        '\n\nGiven where this month stands, what should I watch, and is there anything I should move between categories?',
    )
  }

  // Pace is asked of day-to-day spending only. Against the month's whole plan
  // it would say "12% used, 68% elapsed" all the way up to the day the rent
  // posts, and then flip — which is a fact about the calendar, not about how
  // the month is going.
  const overPace = pulse.everydaySpent > pulse.everydayPaceTarget + 1
  const budgetPct =
    pulse.everydayPlan > 0 ? Math.round((pulse.everydaySpent / pulse.everydayPlan) * 100) : 0
  const elapsedPct = pulse.daysTotal > 0 ? Math.round((pulse.daysElapsed / pulse.daysTotal) * 100) : 0
  const hasAnything = pulse.transactionCount > 0 || pulse.plannedSpend > 0

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl">This month</h2>
          <p className="text-muted">
            Log spending as it happens, drop in a Revolut export, and see where the budget stands
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select className="input w-auto" value={activeMonth} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(`${m}-01`, locale)}
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={discuss}>
            <IconChat width={16} height={16} /> Discuss
          </button>
          <button className="btn-primary" onClick={() => setImporting(true)}>
            <IconUpload width={16} height={16} /> Import
          </button>
        </div>
      </div>

      {/* Hand-logged lines a statement has now brought in again. Loud, because
          until one side goes the month reads high by exactly this much. */}
      {pulse.duplicates.length > 0 && (
        <div className="card p-5 border-gold/50 bg-gold/5">
          <h3 className="text-lg">
            {pulse.duplicates.length} {pulse.duplicates.length === 1 ? 'spend is' : 'spends are'} counted twice
          </h3>
          <p className="text-sm text-muted mb-3">
            An import has brought in the real version of{' '}
            {pulse.duplicates.every((p) => p.kind === 'assumed')
              ? 'bills this month had assumed were paid'
              : pulse.duplicates.every((p) => p.kind === 'logged')
                ? 'spends you logged by hand'
                : 'spends that were already standing in for them'}
            . Both are counting, so the month is overstated by{' '}
            {fx(pulse.duplicates.reduce((s, p) => s + Math.abs(p.manual.amount), 0))} until you pick one.
          </p>
          <div className="space-y-2">
            {pulse.duplicates.map((p) => (
              <div
                key={p.manual.id}
                className="rounded-lg border border-line bg-canvas px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className="tabular-nums text-muted">{p.manual.date.slice(5)}</span>{' '}
                    <span className="font-medium">{fx(Math.abs(p.manual.amount))}</span>
                  </div>
                  <div className="text-xs text-muted truncate">
                    {p.kind === 'assumed' ? 'assumed' : 'yours'}: “{p.manual.description}”{' '}
                    {fx(Math.abs(p.manual.amount))} · statement: “{p.imported.description}”{' '}
                    {fx(Math.abs(p.imported.amount))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn-primary text-xs" onClick={() => resolveDuplicate(p, 'imported')}>
                    <IconCheck width={14} height={14} /> Keep the statement
                  </button>
                  <button className="btn-subtle text-xs" onClick={() => resolveDuplicate(p, 'manual')}>
                    {p.kind === 'assumed' ? 'Keep the assumed one' : 'Keep mine'}
                  </button>
                  <button className="btn-subtle text-xs" onClick={() => keepBoth(p)} title="They really were two separate spends">
                    Both real
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Spent so far"
          value={fx(pulse.spent)}
          tone={overPace ? 'warn' : 'default'}
          sub={
            pulse.plannedSpend > 0
              ? `of ${fx(pulse.plannedSpend)} planned · day ${pulse.daysElapsed} of ${pulse.daysTotal}`
              : `${pulse.daysElapsed} of ${pulse.daysTotal} days in`
          }
        />
        <Stat
          label="Still to come"
          value={fx(pulse.committedLeft)}
          sub={
            pulse.pending.length
              ? `incl. ${pulse.pending.length} ${pulse.pending.length === 1 ? 'bill' : 'bills'} worth ${fx(pulse.pendingTotal)} not seen yet`
              : 'the budgets you have left to spend'
          }
        />
        <Stat
          label="Free to spend"
          value={fx(pulse.freeToSpend, { signed: true })}
          tone={pulse.freeToSpend >= 0 ? 'good' : 'warn'}
          sub="after what's out, what's coming, and the pots"
        />
        <Stat
          label="Month will land at"
          value={fx(pulse.projectedMonthEnd)}
          tone={pulse.plannedSpend > 0 && pulse.projectedMonthEnd > pulse.plannedSpend + 1 ? 'warn' : 'default'}
          sub={
            pulse.plannedSpend > 0
              ? `${fx(Math.abs(pulse.projectedMonthEnd - pulse.plannedSpend))} ${pulse.projectedMonthEnd > pulse.plannedSpend ? 'over' : 'under'} the ${fx(pulse.plannedSpend)} plan, if it holds`
              : 'no plan set — add lines in Plan'
          }
        />
      </div>

      {pulse.everydayPlan > 0 && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
            <h3 className="text-lg">Day-to-day spending pace</h3>
            <span
              className={classNames('pill', overPace ? 'bg-clay/10 text-clay' : 'bg-forest-tint text-forest')}
            >
              {budgetPct}% of budget · {elapsedPct}% of the month
            </span>
          </div>
          <p className="text-sm text-muted mb-2">
            {fx(pulse.everydaySpent)} of the {fx(pulse.everydayPlan)} that isn't already committed to a bill —
            the part of the month you actually steer.
          </p>
          {/* Two bars, one over the other: how much of the budget is gone, and
              how much of the month has gone. Ahead of the marker is overspending
              for the date, not merely spending. */}
          <div className="relative h-3 rounded-full bg-line overflow-hidden">
            <div
              className={classNames('h-full rounded-full', overPace ? 'bg-clay' : 'bg-forest')}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-ink/60"
              style={{ left: `${Math.min(100, elapsedPct)}%` }}
              title="Where the month is"
            />
          </div>
          <p className="text-sm text-muted mt-2">
            {overPace
              ? `Ahead of an even pace by ${fx(pulse.everydaySpent - pulse.everydayPaceTarget)}. At this rate day-to-day spending ends the month near ${fx(pulse.everydayPaceMonthEnd)}.`
              : `Within an even pace, with ${fx(Math.max(0, pulse.everydayPaceTarget - pulse.everydaySpent))} of slack for the date.`}
          </p>
        </div>
      )}

      {/* ── Log a spend ── */}
      <div className="card p-5">
        <h3 className="text-lg">Log a spend</h3>
        <p className="text-sm text-muted mb-3">
          Anything you paid for that hasn't reached a statement yet. It counts against the budget straight
          away, and if an import later brings in the same day and amount you'll be asked which to keep.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[160px]"
            placeholder="What was it? (e.g. Lunch, Petrol)"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addManual()}
          />
          <select
            className="input w-auto"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          >
            {QUICK_CATS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="input w-28"
            type="text"
            inputMode="decimal"
            placeholder="Amount"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addManual()}
          />
          <input
            className="input w-auto"
            type="date"
            aria-label="When you spent it"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
          <button className="btn-primary" onClick={addManual}>
            <IconPlus width={16} height={16} /> Log
          </button>
        </div>

        {pulse.manualTxs.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line space-y-1.5">
            <div className="label mb-1">
              Logged or assumed this month ·{' '}
              {fx(pulse.manualTxs.reduce((s, t) => s + Math.abs(Math.min(0, t.amount)), 0))}
            </div>
            {pulse.manualTxs.map((t) => (
              <div key={t.id} className="flex items-center gap-3 text-sm py-1">
                <span className="text-muted w-12 shrink-0 tabular-nums">{t.date.slice(5)}</span>
                <span className="flex-1 min-w-0 truncate">{t.description}</span>
                {/* Say plainly which rows nobody observed — these are the app's
                    assumption that a bill was paid, not a record that it was. */}
                {t.plannedLineId && (
                  <span
                    className="pill bg-gold/15 text-gold shrink-0"
                    title="Counted from your plan, not seen on a statement yet"
                  >
                    assumed
                  </span>
                )}
                <span className="pill bg-canvas text-muted shrink-0">{t.category}</span>
                <span className="tabular-nums w-20 text-right shrink-0">
                  {formatMoney(t.amount, currency, locale, { signed: true })}
                </span>
                <button
                  className="text-muted hover:text-clay shrink-0"
                  onClick={() => removeTx(t.id)}
                  aria-label={`Delete ${t.description}`}
                >
                  <IconTrash width={15} height={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Still to land ── */}
      {pulse.pending.length > 0 && (
        <div className="card p-5">
          <h3 className="text-lg">Still to land this month</h3>
          <p className="text-sm text-muted mb-3">
            Planned lines nothing has matched yet, with the day of the month they usually arrive. This is the
            money that isn't free even though it's still in the account. Loans, utilities, insurance and
            subscriptions are counted automatically at the start of the month and never wait here.
          </p>
          <div className="space-y-2">
            {pulse.pending.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{b.label}</div>
                  <div className="text-xs text-muted">
                    {b.category} · usually around the {b.typicalDay}
                    {b.overdue && <span className="text-clay"> · that day has passed</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="tabular-nums">{fx(b.amount)}</span>
                  <button
                    className="btn-subtle text-xs"
                    onClick={() => markPaid(b)}
                    title={`Count ${b.label} as paid at ${fx(b.amount)} on the ${b.typicalDay}`}
                  >
                    <IconCheck width={14} height={14} /> Mark as paid
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── By category ── */}
      {pulse.categories.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="px-6 pt-5 pb-2">
            <h3 className="text-lg">Where the budget stands</h3>
            <p className="text-sm text-muted">
              Spent against plan, and against what this category usually costs you
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-y border-line">
                  <th className="px-6 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Used</th>
                  <th className="px-4 py-2.5 font-medium text-right">Spent</th>
                  <th className="px-4 py-2.5 font-medium text-right">Plan</th>
                  <th className="px-4 py-2.5 font-medium text-right">Left</th>
                  <th className="px-6 py-2.5 font-medium text-right">vs usual</th>
                </tr>
              </thead>
              <tbody>
                {pulse.categories.map((c) => {
                  const pct = c.planned > 0 ? Math.min(100, Math.round((c.actual / c.planned) * 100)) : 0
                  const pacePct =
                    c.planned > 0 ? Math.min(100, Math.round((c.paceTarget / c.planned) * 100)) : 0
                  // Pace is meaningless for a bill: one paid on the 5th is
                  // 100% "used" by the 6th, and colouring that as running hot
                  // would put a warning on every fixed cost all month.
                  const aheadOfPace = !c.committed && c.planned > 0 && c.actual > c.paceTarget + 1
                  return (
                    <tr key={c.eventId ?? c.category} className="border-b border-line/60">
                      <td className="px-6 py-3">
                        <span
                          className={classNames('pill', c.eventId ? 'bg-gold/15 text-gold' : 'bg-canvas text-ink')}
                        >
                          {c.category}
                        </span>
                        {c.eventId ? (
                          <span
                            className="ml-1.5 text-[10px] uppercase tracking-wide text-muted"
                            title="A planned event — its share of the budget for the days it runs this month"
                          >
                            event
                          </span>
                        ) : (
                          c.committed && (
                            <span
                              className="ml-1.5 text-[10px] uppercase tracking-wide text-muted"
                              title="A bill, not a budget — what's left here is already spoken for"
                            >
                              bill
                            </span>
                          )
                        )}
                      </td>
                      <td className="px-4 py-3 min-w-[110px]">
                        {c.planned > 0 ? (
                          <div className="relative h-2 rounded-full bg-line overflow-hidden">
                            <div
                              className={classNames(
                                'h-full rounded-full',
                                c.over > 0 ? 'bg-clay' : aheadOfPace ? 'bg-gold' : 'bg-forest',
                              )}
                              style={{ width: `${pct}%` }}
                            />
                            {!c.committed && (
                              <div
                                className="absolute inset-y-0 w-0.5 bg-ink/50"
                                style={{ left: `${pacePct}%` }}
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted">no plan line</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{fx(c.actual)}</td>
                      <td className="px-4 py-3 text-right text-muted tabular-nums">
                        {c.planned > 0 ? fx(c.planned) : '—'}
                      </td>
                      {/* Green says "yours to spend", so a bill still to be paid
                          must not be green — that money is already committed. */}
                      <td
                        className={classNames(
                          'px-4 py-3 text-right font-medium tabular-nums',
                          c.over > 0 ? 'text-clay' : c.committed ? 'text-muted' : 'text-forest',
                        )}
                      >
                        {c.planned > 0 ? (c.over > 0 ? `−${fx(c.over)}` : fx(c.left)) : '—'}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-muted">
                        {c.average > 0.5 ? (
                          <span className={c.vsAverage > 0 ? 'text-clay' : 'text-forest'}>
                            {c.vsAverage >= 0 ? '▲' : '▼'} {fx(Math.abs(c.vsAverage))}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        hasAnything && (
          <div className="card p-8 text-center">
            <p className="text-muted max-w-md mx-auto">
              Nothing spent yet this month. Log a spend above, or drop in a Revolut export.
            </p>
          </div>
        )
      )}

      {!hasAnything && (
        <div className="card p-8 text-center">
          <p className="text-muted max-w-md mx-auto">
            Nothing here yet. Log spending by hand as it happens, import a Revolut export, or set up the
            monthly plan so this screen has a budget to measure against.
          </p>
          <button className="btn-ghost mt-4 mx-auto" onClick={onGoToPlan}>
            Set up the plan
          </button>
        </div>
      )}

      {monthEvents.length > 0 && (
        <div className="card p-5">
          <h3 className="text-lg">On this month</h3>
          <p className="text-sm text-muted mb-3">
            Spending inside these dates can belong to an event instead of your ordinary month — tag it there
            and it stops reading as everyday overspend.
          </p>
          <div className="space-y-2">
            {monthEvents.map((e) => (
              <button
                key={e.id}
                className="w-full text-left rounded-lg border border-line bg-canvas px-4 py-3 hover:bg-forest-tint/40 transition"
                onClick={onGoToEvents}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium truncate">{e.label}</span>
                  <span className={classNames('text-sm tabular-nums shrink-0', e.over && 'text-clay')}>
                    {fx(e.spent)} of {fx(e.budget)}
                  </span>
                </div>
                <div className="text-xs text-muted mt-1">
                  {e.phase === 'live' ? 'Happening now' : e.phase === 'upcoming' ? 'Coming up' : 'Just finished'}
                  {e.over ? ` · ${fx(-e.remaining)} over` : ` · ${fx(e.remaining)} left`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          title="Import into this month"
          subtitle="A Revolut CSV or a statement PDF — parsed on your device, added to this month's actuals"
          existing={data.transactions}
        />
      )}
    </div>
  )
}
