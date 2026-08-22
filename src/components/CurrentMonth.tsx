import { useMemo, useState } from 'react'
import { useData } from '../store'
import {
  assumptionKey,
  computeMonthPulse,
  monthPulseText,
  type DuplicatePair,
} from '../lib/month'
import { monthsWithData } from '../lib/forecast'
import { potMovements } from '../lib/provisions'
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
  const pots = useMemo(() => potMovements(data, [activeMonth]), [data, activeMonth])
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

  /**
   * Count a planned bill as settled. A note against the budget pocket, not a
   * transaction: nothing is invented that a statement could later be asked to
   * confirm, and the moment a real charge answers to the line the pocket is
   * filled by the charge instead.
   */
  function markPaid(lineId: string, amount: number) {
    update((d) => {
      const key = assumptionKey(activeMonth, lineId)
      d.assumedPaid = { ...(d.assumedPaid ?? {}), [key]: Math.abs(amount) }
      d.autoPaySkips = (d.autoPaySkips ?? []).filter((k) => k !== key)
      return d
    })
  }

  /**
   * Take the assumption back. A fixed cost would otherwise reassume itself on
   * the next render — it is counted by default — so saying no has to be
   * recorded, not merely done.
   */
  function unassume(lineId: string) {
    update((d) => {
      const key = assumptionKey(activeMonth, lineId)
      const next = { ...(d.assumedPaid ?? {}) }
      delete next[key]
      d.assumedPaid = next
      d.autoPaySkips = Array.from(new Set([...(d.autoPaySkips ?? []), key]))
      return d
    })
  }

  function removeTx(id: string) {
    update((d) => {
      d.transactions = d.transactions.filter((x) => x.id !== id)
      return d
    })
  }

  /** Correct a row in place — an assumption is a guess, and guesses are wrong. */
  function editTx(id: string, fields: Partial<Transaction>) {
    update((d) => {
      const t = d.transactions.find((x) => x.id === id)
      if (!t) return d
      Object.assign(t, fields)
      if (fields.date) t.month = fields.date.slice(0, 7)
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
  /**
   * The pairing was wrong: two spends really did happen. Recorded as a flag so
   * it can be taken back — this used to rewrite the description, which stuck
   * "(confirmed separate)" on the row for good and lost the original wording.
   */
  function keepBoth(pair: DuplicatePair) {
    update((d) => {
      const t = d.transactions.find((x) => x.id === pair.manual.id)
      if (t) t.notDuplicate = true
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

  /**
   * The budgets you steer: not a bill, not an event, and actually budgeted.
   * Each carries the only figure that helps mid-month — what is left divided by
   * the days left — against the rate it has actually been going at.
   */
  const variableRows = useMemo(
    () =>
      pulse.categories
        .filter((c) => !c.committed && !c.eventId && c.planned > 0.5)
        .map((c) => {
          const perDay = pulse.daysLeft > 0 ? c.left / pulse.daysLeft : 0
          const wasPerDay = pulse.daysElapsed > 0 ? c.actual / pulse.daysElapsed : 0
          // The day the budget runs dry if nothing changes.
          const daysAtRate = wasPerDay > 0 ? Math.floor(c.left / wasPerDay) : Infinity
          return {
            ...c,
            perDay: Math.round(perDay * 100) / 100,
            wasPerDay: Math.round(wasPerDay * 100) / 100,
            runsOutOn: Math.min(pulse.daysTotal, pulse.daysElapsed + Math.max(0, daysAtRate)),
          }
        })
        .sort((a, b) => b.planned - a.planned),
    [pulse],
  )
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
            An import has brought in the real version of spends you logged by hand. Both are counting, so
            the month is overstated by{' '}
            {fx(pulse.duplicates.reduce((s, p) => s + Math.abs(p.manual.amount), 0))} until you pick one.
          </p>
          <div className="space-y-2">
            {/* The two candidates get a line each. Squeezed onto one they were
                truncated on a phone at exactly the moment you need to read both
                to decide which is real. */}
            {pulse.duplicates.map((p) => (
              <div key={p.manual.id} className="rounded-lg border border-line bg-canvas px-4 py-3">
                <div className="grid gap-1 mb-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words">
                      <span className="text-muted text-xs">yours · {p.manual.date.slice(5)} </span>
                      {p.manual.description}
                    </span>
                    <span className="tabular-nums shrink-0">{fx(Math.abs(p.manual.amount))}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words">
                      <span className="text-muted text-xs">statement · {p.imported.date.slice(5)} </span>
                      {p.imported.description}
                    </span>
                    <span className="tabular-nums shrink-0">{fx(Math.abs(p.imported.amount))}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primary text-xs" onClick={() => resolveDuplicate(p, 'imported')}>
                    <IconCheck width={14} height={14} /> Keep the statement
                  </button>
                  <button className="btn-subtle text-xs" onClick={() => resolveDuplicate(p, 'manual')}>
                    Keep mine
                  </button>
                  <button
                    className="btn-subtle text-xs"
                    onClick={() => keepBoth(p)}
                    title="They really were two separate spends — this can be undone from the row below"
                  >
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
            (pulse.plannedSpend > 0
              ? `of ${fx(pulse.plannedSpend)} planned · day ${pulse.daysElapsed} of ${pulse.daysTotal}`
              : `${pulse.daysElapsed} of ${pulse.daysTotal} days in`) +
            (pulse.assumedTotal > 0.5 ? ` · ${fx(pulse.assumedTotal)} of it assumed` : '')
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
            {fx(pulse.everydaySpent)} of the {fx(pulse.everydayPlan)} that isn't a bill, an event, or money
            being put by — the part of the month you actually steer.
          </p>
          {/* The filled bar is the budget spent; the marker is today. Past the
              marker is spending ahead of the date, not merely spending — but a
              bare line said none of that, so it is labelled. */}
          <div className="relative h-3 rounded-full bg-line overflow-hidden">
            <div
              className={classNames('h-full rounded-full', overPace ? 'bg-clay' : 'bg-forest')}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-ink/70"
              style={{ left: `${Math.min(100, elapsedPct)}%` }}
            />
          </div>
          <div className="relative h-4 mt-0.5 text-[11px] text-muted">
            <span
              className="absolute whitespace-nowrap -translate-x-1/2"
              style={{
                // Pinned inside the track so the label can't hang off either end
                // on day 1 or day 31.
                left: `${Math.min(88, Math.max(12, elapsedPct))}%`,
              }}
            >
              ↑ today, day {pulse.daysElapsed} of {pulse.daysTotal}
            </span>
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
              Logged this month ·{' '}
              {fx(pulse.manualTxs.reduce((s, t) => s + Math.abs(Math.min(0, t.amount)), 0))}
            </div>
            {/* Every field stays editable — a spend typed at the till is a
                guess about a receipt you no longer have. */}
            {pulse.manualTxs.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm py-1.5 border-b border-line/40 last:border-0">
                <input
                  type="date"
                  className="bg-transparent text-muted text-xs outline-none focus:text-forest shrink-0"
                  aria-label={`Date of ${t.description}`}
                  value={t.date}
                  onChange={(e) => e.target.value && editTx(t.id, { date: e.target.value })}
                />
                <input
                  className="bg-transparent outline-none flex-1 min-w-[6rem] focus:text-forest"
                  aria-label={`Description of ${t.description}`}
                  defaultValue={t.description}
                  onBlur={(e) => editTx(t.id, { description: e.target.value.trim() || t.description })}
                />
                {t.notDuplicate && (
                  <button
                    className="pill bg-canvas text-muted shrink-0 hover:text-ink"
                    title="You said this wasn't a duplicate. Click to let it be checked again."
                    onClick={() => editTx(t.id, { notDuplicate: undefined })}
                  >
                    kept separate ×
                  </button>
                )}
                <select
                  className="bg-transparent text-xs text-muted outline-none focus:text-forest shrink-0 max-w-[7rem]"
                  aria-label={`Category of ${t.description}`}
                  value={t.category}
                  onChange={(e) => editTx(t.id, { category: e.target.value })}
                >
                  {QUICK_CATS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  className="bg-transparent tabular-nums w-20 text-right outline-none focus:text-forest shrink-0"
                  aria-label={`Amount of ${t.description}`}
                  defaultValue={Math.abs(t.amount)}
                  onBlur={(e) => {
                    const v = parseAmount(e.target.value)
                    if (v) editTx(t.id, { amount: t.amount < 0 ? -Math.abs(v) : Math.abs(v) })
                  }}
                />
                <button
                  className="text-muted hover:text-clay shrink-0"
                  onClick={() => removeTx(t.id)}
                  aria-label={`Delete ${t.description}`}
                  title="Delete"
                >
                  <IconTrash width={15} height={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Variable spending ── */}
      {(variableRows.length > 0 || pulse.pending.length > 0 || pulse.assumed.length > 0) && (
        <div className="card p-5">
          <h3 className="text-lg">Variable spending</h3>
          <p className="text-sm text-muted mb-3">
            The budgets you spend down a bit at a time. What matters is not the €400 you set for food but
            what you can still spend a day on it — so that is the number.
          </p>

          <div className="space-y-2">
            {variableRows.map((r) => (
              <div key={r.category} className="rounded-lg border border-line bg-canvas px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium min-w-0 break-words">{r.category}</span>
                  <span
                    className={classNames(
                      'tabular-nums shrink-0 text-sm',
                      r.over > 0 ? 'text-clay' : 'text-forest',
                    )}
                  >
                    {r.over > 0 ? `${fx(r.over)} over` : `${fx(r.left)} left`}
                  </span>
                </div>
                {/* The actionable sentence, not the budget. */}
                <div className="text-xs text-muted mt-0.5">
                  {r.over > 0
                    ? `Nothing left — ${fx(r.actual)} spent of ${fx(r.planned)}.`
                    : pulse.daysLeft <= 0
                      ? `${fx(r.actual)} spent of ${fx(r.planned)} — the month is done.`
                      : `${fx(r.perDay)} a day for the ${pulse.daysLeft} ${pulse.daysLeft === 1 ? 'day' : 'days'} left` +
                        (r.wasPerDay > 0
                          ? ` · you've been spending ${fx(r.wasPerDay)} a day`
                          : '')}
                </div>
                {r.over <= 0 && pulse.daysLeft > 0 && r.wasPerDay > r.perDay + 0.5 && (
                  <div className="text-xs text-clay mt-0.5">
                    At that rate it runs out around day {r.runsOutOn} of {pulse.daysTotal} — about{' '}
                    {fx(r.wasPerDay - r.perDay)} a day less keeps it to the end of the month.
                  </div>
                )}
                <div className="mt-1.5 h-1.5 rounded-full bg-line overflow-hidden">
                  <div
                    className={classNames(
                      'h-full rounded-full',
                      r.over > 0 ? 'bg-clay' : r.wasPerDay > r.perDay + 0.5 ? 'bg-gold' : 'bg-forest',
                    )}
                    style={{ width: `${r.planned > 0 ? Math.min(100, (r.actual / r.planned) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Bills belong to the same question — what is left of the month —
              but they are not something you pace, so they sit apart. */}
          {pulse.pending.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line">
              <div className="label mb-2">Bills not seen yet · {fx(pulse.pendingTotal)}</div>
              <div className="space-y-2">
                {pulse.pending.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-line bg-canvas px-4 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium break-words">{b.label}</div>
                      <div className="text-xs text-muted">
                        {b.category} · usually around the {b.typicalDay}
                        {b.overdue && <span className="text-clay"> · that day has passed</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-auto">
                      <span className="tabular-nums text-sm">{fx(b.amount)}</span>
                      <button
                        className="btn-subtle text-xs"
                        onClick={() => markPaid(b.id, b.amount)}
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

          {/* Pockets the month counts as filled without a statement to prove
              it. Kept visibly apart from everything above: a figure taken on
              trust that reads exactly like an observed one is how a guess ends
              up quoted back as a fact. */}
          {pulse.assumed.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line">
              <div className="label mb-2">Counted as paid · {fx(pulse.assumedTotal)}</div>
              <p className="text-xs text-muted mb-2">
                No statement has shown these yet — they're counted because they always go out. Correct
                the amount if it was different, or take one back if it hasn't left.
              </p>
              <div className="space-y-2">
                {pulse.assumed.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-line bg-canvas px-4 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium break-words">{a.label}</div>
                      <div className="text-xs text-muted">
                        {a.category} · around the {a.day} ·{' '}
                        {a.auto ? 'counted automatically' : 'you marked it paid'}
                        {Math.abs(a.amount - a.planAmount) > 0.005 && (
                          <span> · plan says {fx(a.planAmount)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="bg-transparent tabular-nums w-20 text-right text-sm outline-none focus:text-forest border-b border-line focus:border-forest"
                        aria-label={`Amount counted for ${a.label}`}
                        defaultValue={a.amount}
                        onBlur={(e) => {
                          const v = parseAmount(e.target.value)
                          if (v && Math.abs(v - a.amount) > 0.005) markPaid(a.id, v)
                        }}
                      />
                      <button
                        className="text-muted hover:text-clay"
                        onClick={() => unassume(a.id)}
                        aria-label={`Stop counting ${a.label} as paid`}
                        title="It hasn't left yet — put it back on the waiting list"
                      >
                        <IconTrash width={15} height={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Money put by ── */}
      {(pulse.plannedSetAside > 0.5 || pulse.setAside > 0.5 || pots.length > 0) && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="text-lg">Money put by</h3>
            <span className="tabular-nums text-sm text-muted">
              {fx(pulse.setAside)} of {fx(pulse.plannedSetAside)} planned
            </span>
          </div>
          <p className="text-sm text-muted mb-3">
            Kept rather than spent, so none of it is in the spending figures above or in the pace —
            putting €300 into the tax pot says nothing about how you're living this month.
          </p>

          {pulse.plannedSetAside > 0.5 && (
            <>
              <div className="h-2 rounded-full bg-line overflow-hidden">
                <div
                  className="h-full bg-forest rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round((pulse.setAside / pulse.plannedSetAside) * 100))}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted mt-1.5">
                {pulse.setAsideLeft > 0.5
                  ? `${fx(pulse.setAsideLeft)} still to move this month — already counted against what's free to spend.`
                  : 'Everything the plan asks for this month has been moved.'}
              </p>
            </>
          )}

          {pulse.setAsideSplit.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mt-3">
              {pulse.setAsideSplit.map((b) => (
                <span key={b.label} className="tabular-nums">
                  {b.label} <span className="text-ink">{fx(b.actual)}</span>
                  {b.planned > 0.5 && ` of ${fx(b.planned)}`}
                </span>
              ))}
            </div>
          )}

          {pots.length > 0 ? (
            <div className="mt-3 space-y-2">
              {pots.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-line bg-canvas px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium break-words">{p.label}</div>
                    <div className="text-xs text-muted tabular-nums">
                      {p.contributed > 0.005 && `${fx(p.contributed)} in`}
                      {p.contributed > 0.005 && p.drawn > 0.005 && ' · '}
                      {p.drawn > 0.005 && `${fx(p.drawn)} out`}
                      {' · now holds '}
                      {fx(p.balance)}
                      {p.target > 0.005 && ` of ${fx(p.target)}`}
                    </div>
                  </div>
                  <span
                    className={classNames(
                      'tabular-nums text-sm shrink-0 ml-auto',
                      p.net >= 0 ? 'text-forest' : 'text-gold',
                    )}
                  >
                    {fx(p.net, { signed: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted mt-3">
              Nothing has moved into or out of a pot this month. Allocate a transfer to one when you
              reconcile and it will show up here.
            </p>
          )}
        </div>
      )}

      {/* Costs the plan carries that simply are not due yet — the answer to
          "where is my insurance?" when the premium is annual. Never in any
          figure above: this month does not owe them. */}
      {pulse.upcoming.length > 0 && (
        <div className="card p-5">
          <h3 className="text-lg">Not this month</h3>
          <p className="text-sm text-muted mb-3">
            Planned costs that aren't due in {formatMonthLabel(`${activeMonth}-01`, locale)} — they land in a
            later month, so nothing above budgets for them. Start a pot in your plan and you can put them by a
            month at a time instead of taking them whole.
          </p>
          <div className="space-y-2">
            {pulse.upcoming.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{b.label}</div>
                  <div className="text-xs text-muted">
                    {b.category} · lands {formatMonthLabel(b.date, locale)}
                  </div>
                </div>
                <span className="tabular-nums text-muted shrink-0">{fx(b.amount)}</span>
              </div>
            ))}
          </div>
          <button className="btn-subtle text-xs mt-3" onClick={onGoToPlan}>
            Save up for these in your plan
          </button>
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
                        {/* Otherwise a category whose whole bill a pot paid
                            reads as €0 spent with no explanation. */}
                        {c.provisionCovered > 0.5 && (
                          <div className="text-[11px] text-muted mt-0.5">
                            {fx(c.provisionCovered)} paid from provisions
                          </div>
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
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium min-w-0 break-words">{e.label}</span>
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
