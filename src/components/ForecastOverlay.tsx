import { useState } from 'react'
import type { ForecastPoint } from '../lib/types'
import type { SummaryPoint } from '../lib/forecast'
import { formatMoney, formatMonthLabel, classNames } from '../lib/format'
import { CashFlowChart, MonthDetail, monthStamp } from './CashFlowChart'
import { Portal } from './Portal'
import { IconClose } from './icons'

/**
 * The forecast, full page, with one month's figures read out beside it.
 *
 * The inline chart deliberately says nothing on hover: a floating box over an
 * eighteen-month line chart covers the very stretch it is describing, and on a
 * phone it covers most of the chart. Here there is room to put the numbers next
 * to the picture instead of on top of it, so moving across the months rewrites a
 * panel that never moves.
 */
export function ForecastOverlay({
  points,
  currency,
  locale,
  scenario,
  showBalance,
  subtitle,
  onClose,
}: {
  points: SummaryPoint[]
  currency: string
  locale: string
  scenario?: { name: string; points: ForecastPoint[] }
  showBalance?: boolean
  subtitle: string
  onClose: () => void
}) {
  // Open on the current month — the one the reader is standing in.
  const current = points.find((p) => !p.projected && !p.actual) ?? points[0]
  const [month, setMonth] = useState(current?.month ?? '')
  const point = points.find((p) => p.month === month) ?? current
  const withScenario = point && {
    ...point,
    scenarioBalance: scenario?.points.find((p) => p.month === point.month)?.balance,
  }
  const fx = (n: number, opts = {}) => formatMoney(n, currency, locale, { round: true, ...opts })

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
        <div className="bg-paper w-full sm:max-w-5xl sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[94vh] flex flex-col">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl">Cash-flow forecast</h2>
              <p className="text-sm text-muted">{subtitle}</p>
            </div>
            <button className="btn-subtle p-2 shrink-0" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          </div>

          <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0">
            <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
              <CashFlowChart
                points={points}
                currency={currency}
                locale={locale}
                scenario={scenario}
                showBalance={showBalance}
                selected={month}
                onSelect={setMonth}
                height={400}
              />

              <div className="lg:border-l lg:border-line lg:pl-5">
                {withScenario && (
                  <MonthDetail
                    point={withScenario}
                    currency={currency}
                    locale={locale}
                    showBalance={showBalance}
                    scenarioName={scenario?.name}
                    size="lg"
                  />
                )}
                <p className="text-xs text-muted mt-4 pt-3 border-t border-line">
                  Move across the chart to read any month here. Settled months
                  also carry what you had planned for them, so the two sit side
                  by side.
                </p>
              </div>
            </div>

            {/* Every month at once, for the reader who would rather scan than
                hover — and the only way to reach a month by keyboard. */}
            <div className="mt-6 border-t border-line pt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="py-2 pr-4 font-medium">Month</th>
                    <th className="py-2 px-3 font-medium text-right">In</th>
                    <th className="py-2 px-3 font-medium text-right">Out</th>
                    <th className="py-2 px-3 font-medium text-right">Set aside</th>
                    <th className="py-2 px-3 font-medium text-right">Net result</th>
                    {showBalance && <th className="py-2 pl-3 font-medium text-right">Balance</th>}
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr
                      key={p.month}
                      className={classNames(
                        'border-b border-line/60 cursor-pointer',
                        p.month === month ? 'bg-forest-tint/50' : 'hover:bg-canvas/60',
                      )}
                      onClick={() => setMonth(p.month)}
                    >
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatMonthLabel(p.month, locale)}
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
                          {monthStamp(p)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted">{fx(p.income)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted">{fx(p.expenses)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted">
                        {p.setAside > 0.5 ? fx(p.setAside) : '—'}
                      </td>
                      <td
                        className={classNames(
                          'py-2 px-3 text-right tabular-nums font-medium',
                          p.netResult >= 0 ? 'text-forest' : 'text-clay',
                        )}
                      >
                        {fx(p.netResult, { signed: true })}
                      </td>
                      {showBalance && (
                        <td className="py-2 pl-3 text-right tabular-nums">{fx(p.balance)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}
