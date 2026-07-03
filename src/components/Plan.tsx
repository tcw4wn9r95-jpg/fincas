import { useState } from 'react'
import { useData } from '../store'
import { formatMoney, formatMonthLabel, todayISO, uid, classNames, currentMonth } from '../lib/format'
import { startingBalance, totalBalance, anchorMonth } from '../lib/forecast'
import type { Account, Goal } from '../lib/types'
import { Planner } from './Planner'
import { IconPlus, IconTrash } from './icons'

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

export function Plan() {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fx = (n: number) => formatMoney(n, currency, locale)

  // ── Accounts ──
  const [acct, setAcct] = useState({ name: '', balance: '' })
  function addAccount() {
    if (!acct.name.trim()) return
    const a: Account = {
      id: uid(),
      name: acct.name.trim(),
      balance: Number(acct.balance) || 0,
      asOf: todayISO(),
    }
    update((d) => {
      d.accounts.push(a)
      return d
    })
    setAcct({ name: '', balance: '' })
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
    if (!goal.label.trim() || !Number(goal.target)) return
    const g: Goal = {
      id: uid(),
      label: goal.label.trim(),
      target: Number(goal.target),
      saved: Number(goal.saved) || 0,
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
        desc="Your last known balance. The forecast rolls it forward through your plan automatically, so it stays current each month — no re-import needed."
      >
        <div className="space-y-2 mb-4">
          {data.accounts.map((a) => (
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
                <div className="text-[11px] text-muted">as of {formatMonthLabel(a.asOf, locale)}</div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step="0.01"
                  className="bg-transparent text-right outline-none tabular-nums w-32 focus:text-forest"
                  defaultValue={a.balance}
                  onBlur={(e) =>
                    editAccount(a.id, { balance: Number(e.target.value) || 0, asOf: todayISO() })
                  }
                />
                <button className="text-muted hover:text-clay" onClick={() => removeAccount(a.id)}>
                  <IconTrash width={16} height={16} />
                </button>
              </div>
            </div>
          ))}
          {data.accounts.length === 0 && (
            <p className="text-sm text-muted">No accounts yet — add your starting balance below.</p>
          )}
        </div>
        {data.accounts.length > 0 && anchorMonth(data) < currentMonth() && (
          <div className="rounded-lg bg-forest-tint/50 border border-line px-4 py-2.5 mb-4 flex items-center justify-between text-sm">
            <span className="text-muted">
              Rolled forward to {formatMonthLabel(currentMonth(), locale)}
            </span>
            <span className="font-medium tabular-nums">
              {fx(startingBalance(data))}
              <span className="text-muted font-normal">
                {' '}
                (from {fx(totalBalance(data))})
              </span>
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
            type="number"
            placeholder="Balance"
            value={acct.balance}
            onChange={(e) => setAcct({ ...acct, balance: e.target.value })}
          />
          <button className="btn-primary" onClick={addAccount}>
            <IconPlus width={16} height={16} /> Add
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
            type="number"
            placeholder="Target"
            value={goal.target}
            onChange={(e) => setGoal({ ...goal, target: e.target.value })}
          />
          <input
            className="input w-28"
            type="number"
            placeholder="Saved"
            value={goal.saved}
            onChange={(e) => setGoal({ ...goal, saved: e.target.value })}
          />
          <button className="btn-primary" onClick={addGoal}>
            <IconPlus width={16} height={16} /> Add
          </button>
        </div>
      </Section>
    </div>
  )
}
