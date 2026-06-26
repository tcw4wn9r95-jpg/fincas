import { useMemo } from 'react'
import { useData } from '../store'
import { buildForecast, totalBalance } from '../lib/forecast'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'
import { CashFlowChart } from './CashFlowChart'

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

export function Dashboard() {
  const { data } = useData()
  const { currency, locale } = data.settings

  const forecast = useMemo(() => buildForecast(data, 12), [data])
  const balance = totalBalance(data)
  const thisMonth = forecast[0]
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, opts)

  // Cash runway: months of average net burn the current balance covers.
  const avgNet = forecast.reduce((s, f) => s + f.net, 0) / forecast.length
  const lowest = forecast.reduce((min, f) => (f.balance < min.balance ? f : min), forecast[0])
  const savingsRate =
    thisMonth && thisMonth.income > 0
      ? Math.round((thisMonth.net / thisMonth.income) * 100)
      : 0

  const empty = data.accounts.length === 0 && data.recurring.length === 0

  if (empty) {
    return (
      <div className="card p-8 text-center animate-fade-up">
        <h2 className="text-2xl mb-2">Welcome to Fincas</h2>
        <p className="text-muted max-w-md mx-auto">
          Add an account balance and your recurring income and expenses in{' '}
          <span className="text-ink font-medium">Plan</span> to see your cash-flow
          forecast — or load sample data from{' '}
          <span className="text-ink font-medium">Settings</span> to explore.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total balance" value={fx(balance)} sub={`${data.accounts.length} accounts`} />
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
          sub="next 12 months"
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
              Projected balance and monthly net over the next 12 months
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
                <th className="px-4 py-2.5 font-medium text-right">Expenses</th>
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
                  <td className="px-6 py-2.5">
                    {formatMonthLabel(f.month, locale)}
                    {i === 0 && <span className="ml-2 pill bg-forest-tint text-forest">now</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted">{fx(f.income)}</td>
                  <td className="px-4 py-2.5 text-right text-muted">{fx(f.expenses)}</td>
                  <td
                    className={classNames(
                      'px-4 py-2.5 text-right font-medium',
                      f.net >= 0 ? 'text-forest' : 'text-clay',
                    )}
                  >
                    {fx(f.net, { signed: true })}
                  </td>
                  <td className="px-6 py-2.5 text-right font-medium">{fx(f.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
