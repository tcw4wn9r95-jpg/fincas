import { useState } from 'react'
import { useData } from '../store'
import { CATEGORIES } from '../lib/categorize'
import { formatMoney, todayISO, uid, classNames } from '../lib/format'
import type { Account, Cadence, Flow, Goal, RecurringItem } from '../lib/types'
import { IconPlus, IconTrash } from './icons'

const CADENCES: Cadence[] = ['monthly', 'weekly', 'biweekly', 'quarterly', 'annual', 'one-time']

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

  // ── Recurring ──
  const [rec, setRec] = useState({
    label: '',
    amount: '',
    flow: 'expense' as Flow,
    cadence: 'monthly' as Cadence,
    category: 'Housing',
  })
  function addRecurring() {
    if (!rec.label.trim() || !Number(rec.amount)) return
    const item: RecurringItem = {
      id: uid(),
      label: rec.label.trim(),
      amount: Math.abs(Number(rec.amount)),
      flow: rec.flow,
      cadence: rec.cadence,
      category: rec.flow === 'income' ? 'Income' : rec.category,
      startDate: todayISO(),
    }
    update((d) => {
      d.recurring.push(item)
      return d
    })
    setRec({ ...rec, label: '', amount: '' })
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

  const income = data.recurring.filter((r) => r.flow === 'income')
  const expenses = data.recurring.filter((r) => r.flow === 'expense')

  function removeRecurring(id: string) {
    update((d) => {
      d.recurring = d.recurring.filter((r) => r.id !== id)
      return d
    })
  }
  function removeAccount(id: string) {
    update((d) => {
      d.accounts = d.accounts.filter((a) => a.id !== id)
      return d
    })
  }
  function removeGoal(id: string) {
    update((d) => {
      d.goals = d.goals.filter((g) => g.id !== id)
      return d
    })
  }
  function setBudget(cat: string, value: number) {
    update((d) => {
      if (value > 0) d.categoryBudgets[cat] = value
      else delete d.categoryBudgets[cat]
      return d
    })
  }

  const budgetCats = CATEGORIES.filter((c) => c !== 'Income' && c !== 'Transfer')

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h2 className="text-2xl">Your plan</h2>
        <p className="text-muted">The income, expenses and goals behind your forecast</p>
      </div>

      <Section title="Accounts" desc="Current balances — the starting point of the forecast.">
        <div className="space-y-2 mb-4">
          {data.accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg bg-canvas px-4 py-2.5 border border-line"
            >
              <span className="font-medium">{a.name}</span>
              <div className="flex items-center gap-4">
                <span className="tabular-nums">{fx(a.balance)}</span>
                <button className="text-muted hover:text-clay" onClick={() => removeAccount(a.id)}>
                  <IconTrash width={16} height={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
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

      <Section
        title="Recurring income & expenses"
        desc="These drive your cash-flow projection month to month."
      >
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <div className="label">Income</div>
            <div className="space-y-2">
              {income.length === 0 && <p className="text-sm text-muted">None yet.</p>}
              {income.map((r) => (
                <RecurringRow key={r.id} item={r} fx={fx} onRemove={removeRecurring} />
              ))}
            </div>
          </div>
          <div>
            <div className="label">Expenses</div>
            <div className="space-y-2">
              {expenses.length === 0 && <p className="text-sm text-muted">None yet.</p>}
              {expenses.map((r) => (
                <RecurringRow key={r.id} item={r} fx={fx} onRemove={removeRecurring} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <select
            className="input w-32"
            value={rec.flow}
            onChange={(e) => setRec({ ...rec, flow: e.target.value as Flow })}
          >
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <input
            className="input flex-1 min-w-[140px]"
            placeholder="Label (e.g. Salary, Rent)"
            value={rec.label}
            onChange={(e) => setRec({ ...rec, label: e.target.value })}
          />
          <input
            className="input w-28"
            type="number"
            placeholder="Amount"
            value={rec.amount}
            onChange={(e) => setRec({ ...rec, amount: e.target.value })}
          />
          <select
            className="input w-32"
            value={rec.cadence}
            onChange={(e) => setRec({ ...rec, cadence: e.target.value as Cadence })}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {rec.flow === 'expense' && (
            <select
              className="input w-36"
              value={rec.category}
              onChange={(e) => setRec({ ...rec, category: e.target.value })}
            >
              {budgetCats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <button className="btn-primary" onClick={addRecurring}>
            <IconPlus width={16} height={16} /> Add
          </button>
        </div>
      </Section>

      <Section
        title="Monthly budgets"
        desc="Set a planned monthly spend per category. Money dates compare your actuals against these."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {budgetCats.map((cat) => (
            <div
              key={cat}
              className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2 border border-line"
            >
              <span className="text-sm">{cat}</span>
              <input
                className="w-24 bg-transparent text-right text-sm outline-none tabular-nums"
                type="number"
                placeholder="0"
                value={data.categoryBudgets[cat] ?? ''}
                onChange={(e) => setBudget(cat, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </Section>

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

function RecurringRow({
  item,
  fx,
  onRemove,
}: {
  item: RecurringItem
  fx: (n: number) => string
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2 border border-line">
      <div className="min-w-0">
        <div className="font-medium truncate">{item.label}</div>
        <div className="text-xs text-muted">
          {item.cadence}
          {item.flow === 'expense' && ` · ${item.category}`}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span
          className={classNames(
            'tabular-nums text-sm',
            item.flow === 'income' ? 'text-forest' : 'text-clay',
          )}
        >
          {fx(item.amount)}
        </span>
        <button className="text-muted hover:text-clay" onClick={() => onRemove(item.id)}>
          <IconTrash width={16} height={16} />
        </button>
      </div>
    </div>
  )
}
