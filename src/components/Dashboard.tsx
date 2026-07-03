import { useMemo, useRef } from 'react'
import { useData } from '../store'
import { buildForecast, startingBalance, forecastHorizon } from '../lib/forecast'
import { demoData, importData } from '../lib/storage'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'
import { CashFlowChart } from './CashFlowChart'
import { Logo, IconPlan, IconUpload } from './icons'

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
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

export function Dashboard({ goTo }: { goTo: (tab: 'plan' | 'settings') => void }) {
  const { data, setData } = useData()
  const { currency, locale } = data.settings
  const fileRef = useRef<HTMLInputElement>(null)

  const forecast = useMemo(() => buildForecast(data, forecastHorizon(data)), [data])
  const balance = startingBalance(data)
  const thisMonth = forecast[0]
  // Whole numbers at a glance; cents live in the planner where precision matters.
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, { round: true, ...opts })

  const avgNet = forecast.reduce((s, f) => s + f.net, 0) / forecast.length
  const lowest = forecast.reduce((min, f) => (f.balance < min.balance ? f : min), forecast[0])
  const savingsRate =
    thisMonth && thisMonth.income > 0
      ? Math.round((thisMonth.net / thisMonth.income) * 100)
      : 0

  const empty = data.accounts.length === 0 && data.recurring.length === 0

  async function restore(file: File) {
    try {
      setData(await importData(file))
    } catch {
      /* invalid file — the Settings restore flow reports errors in detail */
    }
  }

  if (empty) {
    return (
      <div className="max-w-lg mx-auto text-center pt-8 animate-fade-up">
        <Logo className="w-16 h-16 mx-auto rounded-2xl shadow-lift mb-6" />
        <h2 className="text-3xl mb-2">Welcome to CasaresSan Finances</h2>
        <p className="text-muted mb-8">
          Your private, on-device financial advisor. Set up your plan and see your
          cash-flow future in minutes — nothing ever leaves this device.
        </p>
        <div className="space-y-3 text-left">
          <button
            className="card w-full p-4 flex items-center gap-4 hover:shadow-lift transition text-left"
            onClick={() => goTo('plan')}
          >
            <span className="w-10 h-10 rounded-xl bg-forest text-paper grid place-items-center shrink-0">
              <IconPlan width={20} height={20} />
            </span>
            <span>
              <span className="block font-medium">Build my plan</span>
              <span className="block text-sm text-muted">
                Add balances, income and expenses month by month
              </span>
            </span>
          </button>
          <button
            className="card w-full p-4 flex items-center gap-4 hover:shadow-lift transition text-left"
            onClick={() => fileRef.current?.click()}
          >
            <span className="w-10 h-10 rounded-xl bg-forest-tint text-forest grid place-items-center shrink-0">
              <IconUpload width={20} height={20} />
            </span>
            <span>
              <span className="block font-medium">Restore a backup</span>
              <span className="block text-sm text-muted">
                Load a CasaresSan Finances file from your device or Drive
              </span>
            </span>
          </button>
          <button
            className="w-full text-center text-sm text-muted hover:text-forest transition pt-2"
            onClick={() => setData(demoData())}
          >
            …or explore with sample data first
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) restore(f)
            e.target.value = ''
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total balance" value={fx(balance)} sub={`${data.accounts.length} ${data.accounts.length === 1 ? 'account' : 'accounts'}`} />
        <Stat
          label="This month net"
          value={fx(thisMonth?.net ?? 0, { signed: true })}
          tone={(thisMonth?.net ?? 0) >= 0 ? 'good' : 'warn'}
          sub={`${fx(thisMonth?.income ?? 0)} in · ${fx(thisMonth?.expenses ?? 0)} out`}
        />
        <Stat
          label="Avg monthly net"
          value={fx(avgNet, { signed: true })}
          tone={avgNet >= 0 ? 'good' : 'warn'}
          sub={`next ${forecast.length} months`}
        />
        <Stat
          label="Savings rate"
          value={`${savingsRate}%`}
          tone={savingsRate >= 0 ? 'good' : 'warn'}
          sub="of this month's income"
        />
      </div>

      <div className="card p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h2 className="text-xl">Cash-flow forecast</h2>
            <p className="text-sm text-muted">
              Income, fixed vs variable expenses, and projected balance · next{' '}
              {forecast.length} months
            </p>
          </div>
          {lowest && lowest.balance < balance && (
            <div className="text-right">
              <div className="label">Projected low</div>
              <div
                className={classNames(
                  'font-serif text-lg',
                  lowest.balance < 0 ? 'text-clay' : 'text-ink',
                )}
              >
                {fx(lowest.balance)}
              </div>
              <div className="text-xs text-muted">{formatMonthLabel(lowest.month, locale)}</div>
            </div>
          )}
        </div>
        <CashFlowChart points={forecast} currency={currency} locale={locale} />
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-xl">The actual numbers</h2>
          <p className="text-sm text-muted">Month-by-month projection</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-y border-line">
                <th className="px-6 py-2.5 font-medium">Month</th>
                <th className="px-4 py-2.5 font-medium text-right">Income</th>
                <th className="px-4 py-2.5 font-medium text-right">Fixed</th>
                <th className="px-4 py-2.5 font-medium text-right">Variable</th>
                <th className="px-4 py-2.5 font-medium text-right">Net</th>
                <th className="px-6 py-2.5 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((f, i) => (
                <tr
                  key={f.month}
                  className={classNames(
                    'border-b border-line/60',
                    i === 0 && 'bg-forest-tint/50',
                  )}
                >
                  <td className="px-6 py-2.5 whitespace-nowrap">
                    {formatMonthLabel(f.month, locale)}
                    {i === 0 && <span className="ml-2 pill bg-forest-tint text-forest">now</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted tabular-nums">{fx(f.income)}</td>
                  <td className="px-4 py-2.5 text-right text-muted tabular-nums">{fx(f.fixedExpenses)}</td>
                  <td className="px-4 py-2.5 text-right text-muted tabular-nums">{fx(f.variableExpenses)}</td>
                  <td
                    className={classNames(
                      'px-4 py-2.5 text-right font-medium tabular-nums',
                      f.net >= 0 ? 'text-forest' : 'text-clay',
                    )}
                  >
                    {fx(f.net, { signed: true })}
                  </td>
                  <td className="px-6 py-2.5 text-right font-medium tabular-nums">{fx(f.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
