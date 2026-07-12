import { useMemo, useState } from 'react'
import { useData } from '../store'
import type { AppData, Flow, Scenario, ScenarioAdjustment } from '../lib/types'
import { applyScenario, buildForecast, forecastHorizon, scenarioSummary } from '../lib/forecast'
import { CATEGORIES } from '../lib/categorize'
import { uid, formatMoney, formatMonthLabel, parseAmount } from '../lib/format'
import { IconPlus, IconTrash, IconClose } from './icons'

const expenseCats = CATEGORIES.filter((c) => c !== 'Income')

/**
 * The scenario switcher that sits above the forecast chart. Chips flip between
 * the baseline plan and each saved what-if; the active one overlays on the
 * chart (handled by the Dashboard) and shows its end-of-plan delta here.
 */
export function ScenarioBar() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const scenarios = data.scenarios ?? []
  const active = scenarios.find((s) => s.id === data.activeScenarioId)
  const [editing, setEditing] = useState<Scenario | null>(null)

  const summary = useMemo(
    () => (active ? scenarioSummary(data, active) : null),
    [data, active],
  )
  const fx = (n: number) => formatMoney(n, currency, locale, { round: true })
  const fxSigned = (n: number) => formatMoney(n, currency, locale, { round: true, signed: true })

  function setActive(id?: string) {
    update((d) => {
      d.activeScenarioId = id
      return d
    })
  }

  function startNew() {
    setEditing({
      id: uid(),
      name: `Scenario ${scenarios.length + 1}`,
      adjustments: [],
      createdAt: new Date().toISOString(),
    })
  }

  function saveScenario(next: Scenario) {
    update((d) => {
      const list = d.scenarios ?? (d.scenarios = [])
      const i = list.findIndex((s) => s.id === next.id)
      if (i >= 0) list[i] = next
      else list.push(next)
      d.activeScenarioId = next.id
      return d
    })
    setEditing(null)
  }

  function remove(id: string) {
    update((d) => {
      d.scenarios = (d.scenarios ?? []).filter((s) => s.id !== id)
      if (d.activeScenarioId === id) d.activeScenarioId = undefined
      return d
    })
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label mr-1">What-if</span>
        <button
          onClick={() => setActive(undefined)}
          className={chip(!active)}
        >
          Baseline
        </button>
        {scenarios.map((s) => (
          <button key={s.id} onClick={() => setActive(s.id)} className={chip(active?.id === s.id)}>
            {s.name}
          </button>
        ))}
        <button
          onClick={startNew}
          className="pill border border-dashed border-line text-muted hover:text-forest hover:border-forest transition inline-flex items-center gap-1"
        >
          <IconPlus width={13} height={13} /> New
        </button>
      </div>

      {active && summary && (
        <div className="mt-3 card p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="label">End of plan · {active.name}</div>
            <div className="font-serif text-lg text-[#6d5296]">{fx(summary.scenarioEnd)}</div>
            <div className="text-xs text-muted">baseline {fx(summary.baseEnd)}</div>
          </div>
          <div>
            <div className="label">Difference</div>
            <div
              className={
                'font-serif text-lg ' + (summary.endDiff >= 0 ? 'text-forest' : 'text-clay')
              }
            >
              {fxSigned(summary.endDiff)}
            </div>
            <div className="text-xs text-muted">by end of plan</div>
          </div>
          <div>
            <div className="label">Lowest point</div>
            <div
              className={
                'font-serif text-lg ' + (summary.scenarioLow < 0 ? 'text-clay' : 'text-ink')
              }
            >
              {fx(summary.scenarioLow)}
            </div>
            <div className="text-xs text-muted">baseline {fx(summary.baseLow)}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setEditing(active)}>
              Edit
            </button>
            <button
              className="btn-subtle p-2 text-muted hover:text-clay"
              onClick={() => remove(active.id)}
              aria-label="Delete scenario"
            >
              <IconTrash width={16} height={16} />
            </button>
          </div>
          {!active.adjustments.length && (
            <div className="w-full text-sm text-muted">
              This scenario has no changes yet — it matches the baseline. Edit it to add a
              what-if.
            </div>
          )}
        </div>
      )}

      {editing && (
        <ScenarioModal
          scenario={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSave={saveScenario}
        />
      )}
    </div>
  )
}

function chip(activeState: boolean) {
  return (
    'pill transition ' +
    (activeState
      ? 'bg-forest text-paper'
      : 'bg-forest-tint text-forest hover:bg-forest hover:text-paper')
  )
}

// ── Editor ────────────────────────────────────────────────────────

function ScenarioModal({
  scenario,
  data,
  onClose,
  onSave,
}: {
  scenario: Scenario
  data: AppData
  onClose: () => void
  onSave: (s: Scenario) => void
}) {
  const { currency, locale } = data.settings
  const [name, setName] = useState(scenario.name)
  const [adjustments, setAdjustments] = useState<ScenarioAdjustment[]>(scenario.adjustments)
  const lines = data.recurring

  // Live preview: re-run the forecast through the draft scenario.
  const preview = useMemo(() => {
    const draft: Scenario = { ...scenario, name, adjustments }
    const count = forecastHorizon(data)
    const base = buildForecast(data, count)
    const scen = buildForecast(applyScenario(data, draft), count)
    const end = (p: typeof base) => (p.length ? p[p.length - 1].balance : 0)
    return { baseEnd: end(base), scenarioEnd: end(scen) }
  }, [data, scenario, name, adjustments])
  const fx = (n: number) => formatMoney(n, currency, locale, { round: true })
  const diff = preview.scenarioEnd - preview.baseEnd

  function addAdjustment() {
    const firstLine = lines[0]
    setAdjustments((a) => [
      ...a,
      {
        id: uid(),
        op: firstLine ? 'pause' : 'add',
        targetId: firstLine?.id,
        newLine: firstLine ? undefined : { label: '', flow: 'expense', category: 'Other' },
      },
    ])
  }

  function patch(id: string, next: Partial<ScenarioAdjustment>) {
    setAdjustments((a) => a.map((adj) => (adj.id === id ? { ...adj, ...next } : adj)))
  }

  function removeAdjustment(id: string) {
    setAdjustments((a) => a.filter((adj) => adj.id !== id))
  }

  function save() {
    onSave({ ...scenario, name: name.trim() || 'Scenario', adjustments })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
      <div className="bg-paper w-full sm:max-w-lg sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-xl">What-if scenario</h2>
          <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div>
            <label className="label">Scenario name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Diana takes 3 more months off"
              autoFocus
            />
          </div>

          <div className="space-y-3">
            {adjustments.length === 0 && (
              <p className="text-sm text-muted">
                Add a change below — pause a line, adjust an amount, or add a new cost — and
                see how it bends your balance.
              </p>
            )}
            {adjustments.map((adj) => (
              <AdjustmentRow
                key={adj.id}
                adj={adj}
                lines={lines}
                locale={locale}
                onChange={(next) => patch(adj.id, next)}
                onRemove={() => removeAdjustment(adj.id)}
              />
            ))}
            <button
              onClick={addAdjustment}
              className="btn-ghost w-full justify-center inline-flex items-center gap-1.5"
            >
              <IconPlus width={15} height={15} /> Add a change
            </button>
          </div>

          <div className="rounded-xl bg-canvas border border-line p-4 flex items-center justify-between">
            <div>
              <div className="label">Projected end balance</div>
              <div className="text-xs text-muted">baseline {fx(preview.baseEnd)}</div>
            </div>
            <div className="text-right">
              <div className="font-serif text-xl text-[#6d5296]">{fx(preview.scenarioEnd)}</div>
              <div className={'text-xs ' + (diff >= 0 ? 'text-forest' : 'text-clay')}>
                {formatMoney(diff, currency, locale, { round: true, signed: true })} vs baseline
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save scenario
          </button>
        </div>
      </div>
    </div>
  )
}

const OPS: Array<{ value: ScenarioAdjustment['op']; label: string }> = [
  { value: 'pause', label: 'Pause a line' },
  { value: 'scale', label: 'Change an amount' },
  { value: 'set', label: 'Set a fixed amount' },
  { value: 'add', label: 'Add a new line' },
]

function AdjustmentRow({
  adj,
  lines,
  locale,
  onChange,
  onRemove,
}: {
  adj: ScenarioAdjustment
  lines: AppData['recurring']
  locale: string
  onChange: (next: Partial<ScenarioAdjustment>) => void
  onRemove: () => void
}) {
  function setOp(op: ScenarioAdjustment['op']) {
    if (op === 'add') {
      onChange({ op, targetId: undefined, newLine: adj.newLine ?? { label: '', flow: 'expense', category: 'Other' } })
    } else {
      onChange({
        op,
        targetId: adj.targetId ?? lines[0]?.id,
        value: op === 'scale' ? adj.value ?? 100 : op === 'set' ? adj.value ?? 0 : undefined,
      })
    }
  }

  return (
    <div className="rounded-xl border border-line p-3 space-y-3 bg-paper">
      <div className="flex items-center gap-2">
        <select
          className="input py-1.5 flex-1"
          value={adj.op}
          onChange={(e) => setOp(e.target.value as ScenarioAdjustment['op'])}
        >
          {OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          className="btn-subtle p-2 text-muted hover:text-clay shrink-0"
          onClick={onRemove}
          aria-label="Remove change"
        >
          <IconTrash width={15} height={15} />
        </button>
      </div>

      {adj.op === 'add' ? (
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input py-1.5 col-span-2"
            placeholder="Name, e.g. Daycare"
            defaultValue={adj.newLine?.label ?? ''}
            onChange={(e) =>
              onChange({ newLine: { ...defaultLine(adj), label: e.target.value } })
            }
          />
          <select
            className="input py-1.5"
            value={adj.newLine?.flow ?? 'expense'}
            onChange={(e) =>
              onChange({ newLine: { ...defaultLine(adj), flow: e.target.value as Flow } })
            }
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <div className="relative">
            <input
              className="input py-1.5 tabular-nums"
              type="text"
              inputMode="decimal"
              placeholder="Amount / month"
              defaultValue={adj.value ? String(adj.value) : ''}
              onBlur={(e) => onChange({ value: numOr(e.target.value, 0) })}
            />
          </div>
          {adj.newLine?.flow !== 'income' && (
            <select
              className="input py-1.5 col-span-2"
              value={adj.newLine?.category ?? 'Other'}
              onChange={(e) =>
                onChange({ newLine: { ...defaultLine(adj), category: e.target.value } })
              }
            >
              {expenseCats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <select
            className="input py-1.5"
            value={adj.targetId ?? ''}
            onChange={(e) => onChange({ targetId: e.target.value })}
          >
            {lines.length === 0 && <option value="">No plan lines yet</option>}
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.flow === 'income' ? '↑' : '↓'} {l.label}
              </option>
            ))}
          </select>
          {adj.op === 'scale' && (
            <label className="flex items-center gap-2 text-sm text-muted">
              Set to
              <input
                className="input py-1.5 w-24 tabular-nums"
                type="text"
                inputMode="decimal"
                defaultValue={String(adj.value ?? 100)}
                onBlur={(e) => onChange({ value: numOr(e.target.value, 100) })}
              />
              % of plan
            </label>
          )}
          {adj.op === 'set' && (
            <label className="flex items-center gap-2 text-sm text-muted">
              New amount
              <input
                className="input py-1.5 w-32 tabular-nums"
                type="text"
                inputMode="decimal"
                defaultValue={adj.value ? String(adj.value) : ''}
                onBlur={(e) => onChange({ value: numOr(e.target.value, 0) })}
              />
              / month
            </label>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">From (optional)</label>
          <input
            className="input py-1.5"
            type="month"
            defaultValue={adj.from ?? ''}
            onChange={(e) => onChange({ from: e.target.value || undefined })}
          />
        </div>
        <div>
          <label className="label">Until (optional)</label>
          <input
            className="input py-1.5"
            type="month"
            min={adj.from}
            defaultValue={adj.to ?? ''}
            onChange={(e) => onChange({ to: e.target.value || undefined })}
          />
        </div>
      </div>
      <p className="text-xs text-muted">{describe(adj, lines, locale)}</p>
    </div>
  )
}

function defaultLine(adj: ScenarioAdjustment): { label: string; flow: Flow; category: string } {
  return adj.newLine ?? { label: '', flow: 'expense', category: 'Other' }
}

function numOr(input: string, fallback: number): number {
  const n = parseAmount(input)
  return Number.isNaN(n) ? fallback : Math.abs(n)
}

/** Plain-language recap of one adjustment, shown under its controls. */
function describe(adj: ScenarioAdjustment, lines: AppData['recurring'], locale: string): string {
  const span =
    adj.from && adj.to
      ? ` from ${formatMonthLabel(adj.from + '-01', locale)} through ${formatMonthLabel(adj.to + '-01', locale)}`
      : adj.from
        ? ` from ${formatMonthLabel(adj.from + '-01', locale)} onward`
        : adj.to
          ? ` through ${formatMonthLabel(adj.to + '-01', locale)}`
          : ' for the whole plan'
  if (adj.op === 'add') {
    const l = adj.newLine
    return `Adds ${l?.flow === 'income' ? 'income' : 'an expense'} “${l?.label || 'unnamed'}” of ${adj.value ?? 0}/month${span}.`
  }
  const line = lines.find((l) => l.id === adj.targetId)
  const name = line?.label ?? 'a line'
  if (adj.op === 'pause') return `Pauses “${name}” (sets it to 0)${span}.`
  if (adj.op === 'scale') return `Sets “${name}” to ${adj.value ?? 100}% of plan${span}.`
  return `Sets “${name}” to ${adj.value ?? 0}/month${span}.`
}
