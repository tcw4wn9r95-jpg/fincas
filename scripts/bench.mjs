// A benchmark of the money logic, run against the real library modules.
//
//   node scripts/bench.mjs
//
// Every figure this app shows is derived, and the derivations lean on each
// other: the money date's net feeds the carry-over sweep, the ledger's balance
// leans on the same month flows as the plan page, a provision drawdown has to
// leave the totals in one place and stay in the category table in another. This
// asserts those relationships end to end, on scenarios shaped like the real
// workflow, so a change that quietly breaks one of them fails here rather than
// in a month's numbers.
//
// Months are built relative to the current month, so the run means the same
// thing in August as in March.

import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const F = await server.ssrLoadModule('/src/lib/forecast.ts')
const P = await server.ssrLoadModule('/src/lib/provisions.ts')
const U = await server.ssrLoadModule('/src/lib/funding.ts')
const S = await server.ssrLoadModule('/src/lib/storage.ts')
const fmt = await server.ssrLoadModule('/src/lib/format.ts')

const NOW = fmt.currentMonth()
/** The month `n` months from this one — the whole bench is relative to today. */
const M = (n) => fmt.addMonths(NOW, n)
/** The last day of month `n` — where a statement's closing balance lands. */
const endOf = (n) => {
  const [y, m] = M(n).split('-').map(Number)
  return `${M(n)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

let fails = 0
let checks = 0
const eq = (label, got, want, tol = 0.005) => {
  checks++
  const ok = typeof want === 'number' ? Math.abs(got - want) <= tol : got === want
  if (!ok) {
    fails++
    console.log(`  ✗ ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  } else console.log(`  ✓ ${label} = ${JSON.stringify(got)}`)
}
const ok = (label, cond, detail = '') => {
  checks++
  if (cond) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.log(`  ✗ ${label}${detail ? `: ${detail}` : ''}`)
  }
}

const base = (over = {}) => ({
  version: 1,
  settings: { apiKey: '', model: 'm', currency: 'EUR', locale: 'en-GB' },
  accounts: [],
  recurring: [],
  transactions: [],
  goals: [],
  provisions: [],
  categoryBudgets: {},
  emergencyFund: { targetAmount: 0 },
  events: [],
  updatedAt: '',
  ...over,
})
const tx = (o) => ({
  id: Math.random().toString(36).slice(2),
  source: 'csv',
  reconciled: true,
  ...o,
  month: o.date.slice(0, 7),
})
const line = (o) => ({ cadence: 'monthly', startDate: '2020-01-01', ...o })

console.log('\n── A. A plain month, no pots ──')
{
  const d = base({
    transactions: [
      tx({ date: `${M(-1)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-1)}-02`, description: 'Rent', amount: -1800, category: 'Housing' }),
      tx({ date: `${M(-1)}-05`, description: 'Food', amount: -200, category: 'Food' }),
    ],
  })
  const r = F.computeReview(d, M(-1))
  eq('income', r.income, 3000)
  eq('expenses', r.expenses, 2000)
  eq('setAside', r.setAside, 0)
  eq('net', r.net, 1000)
  eq('cards tie (in − out − aside = net)', r.income - r.expenses - r.setAside, r.net)
  eq('carry-over left to sweep', U.monthCarryover(d, M(-1), r.net).left, 1000)
}

console.log('\n── B. Money set aside stays money ──')
{
  const d = base({
    provisions: [
      { id: 'p1', label: 'Taxes', category: 'Taxes', targetAmount: 3600, dueDate: `${M(3)}-20`, createdAt: '2020-01-01' },
    ],
    transactions: [
      tx({ date: `${M(-1)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-1)}-02`, description: 'Rent', amount: -1800, category: 'Housing' }),
      tx({ date: `${M(-1)}-05`, description: 'Food', amount: -200, category: 'Food' }),
      tx({
        date: `${M(-1)}-08`,
        description: 'To flexible',
        amount: -400,
        category: 'Savings',
        provisionAllocations: [{ provisionId: 'p1', amount: 400, role: 'contribution' }],
      }),
    ],
  })
  const r = F.computeReview(d, M(-1))
  eq('expenses exclude what was set aside', r.expenses, 2000)
  eq('setAside', r.setAside, 400)
  eq('net', r.net, 600)
  eq('netBeforeSetAside', r.netBeforeSetAside, 1000)
  eq('pot funded', P.provisionStatus(d, d.provisions[0]).funded, 400)
}

console.log('\n── C. A provisioned bill lands ──')
{
  const d = base({
    provisions: [
      { id: 'p1', label: 'Taxes', category: 'Taxes', targetAmount: 3600, dueDate: `${M(-1)}-20`, createdAt: '2020-01-01' },
    ],
    transactions: [
      tx({
        date: `${M(-3)}-05`,
        description: 'Fund pot',
        amount: -3600,
        category: 'Savings',
        provisionAllocations: [{ provisionId: 'p1', amount: 3600, role: 'contribution' }],
      }),
      tx({ date: `${M(-1)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-1)}-02`, description: 'Rent', amount: -1800, category: 'Housing' }),
      tx({ date: `${M(-1)}-05`, description: 'Food', amount: -200, category: 'Food' }),
      tx({ date: `${M(-1)}-19`, description: 'From flexible', amount: 3600, category: 'Internal' }),
      tx({
        date: `${M(-1)}-20`,
        description: 'Tax bill',
        amount: -3600,
        category: 'Taxes',
        provisionAllocations: [{ provisionId: 'p1', amount: 3600, role: 'drawdown' }],
      }),
    ],
  })
  const r = F.computeReview(d, M(-1))
  eq('expenses (ordinary only)', r.expenses, 2000)
  eq('provisionedSpend', r.provisionedSpend, 3600)
  eq('net matches what the account really did', r.net, 1000)
  eq('cards tie', r.income - r.expenses - r.setAside, r.net)
  eq('the Taxes row still shows the bill', r.categories.find((c) => c.category === 'Taxes')?.actual, 3600)
  eq('pot drained', P.provisionStatus(d, d.provisions[0]).funded, 0)
}

console.log('\n── D. Over a full cycle, each euro is charged once ──')
{
  const txs = []
  for (const n of [-4, -3, -2]) {
    txs.push(tx({ date: `${M(n)}-01`, description: 'Salary', amount: 3000, category: 'Income' }))
    txs.push(
      tx({
        date: `${M(n)}-08`,
        description: 'To flexible',
        amount: -1200,
        category: 'Savings',
        provisionAllocations: [{ provisionId: 'p1', amount: 1200, role: 'contribution' }],
      }),
    )
  }
  txs.push(tx({ date: `${M(-1)}-01`, description: 'Salary', amount: 3000, category: 'Income' }))
  txs.push(tx({ date: `${M(-1)}-19`, description: 'From flexible', amount: 3600, category: 'Internal' }))
  txs.push(
    tx({
      date: `${M(-1)}-20`,
      description: 'Tax bill',
      amount: -3600,
      category: 'Taxes',
      provisionAllocations: [{ provisionId: 'p1', amount: 3600, role: 'drawdown' }],
    }),
  )
  const d = base({
    provisions: [
      { id: 'p1', label: 'Taxes', category: 'Taxes', targetAmount: 3600, dueDate: `${M(-1)}-20`, createdAt: '2020-01-01' },
    ],
    transactions: txs,
  })
  const rs = [-4, -3, -2, -1].map((n) => F.computeReview(d, M(n)))
  eq('set aside across the four months', rs.reduce((s, r) => s + r.setAside, 0), 3600)
  eq('ordinary spending across them', rs.reduce((s, r) => s + r.expenses, 0), 0)
  eq('the tax is charged exactly once', rs.reduce((s, r) => s + r.setAside + r.expenses, 0), 3600)
  eq('sum of nets = income − what was charged', rs.reduce((s, r) => s + r.net, 0), 12000 - 3600)
  eq('the month the bill lands is not sunk by it', rs[3].net, 3000)
}

console.log('\n── E. The forecast: provisioning must not drain it ──')
{
  const d = base({
    accounts: [
      { id: 'a1', name: 'Revolut', balance: 5000, asOf: `${NOW}-05` },
      { id: 'a2', name: 'Flexible', balance: 1000, asOf: `${NOW}-05` },
    ],
    recurring: [
      line({ id: 'r1', label: 'Salary', amount: 3000, flow: 'income', category: 'Income' }),
      line({ id: 'r2', label: 'Rent', amount: 1800, flow: 'expense', category: 'Housing' }),
      line({ id: 'r3', label: 'Tax provisioning', amount: 500, flow: 'expense', category: 'Taxes', group: 'Provisions' }),
    ],
  })
  const f = F.buildForecast(d, 3)
  eq('total balance', F.totalBalance(d), 6000)
  eq('planned expenses exclude provisioning', f[0].expenses, 1800)
  eq('planned set aside', f[0].setAside, 500)
  eq('net = the change in money held', f[0].net, 1200)
  eq('balance grows by net', f[1].balance - f[0].balance, 1200)
  // Dated the 5th: five days of this month are already inside that figure, so
  // the month opened 5/31 of its net lower.
  const daysThisMonth = new Date(+NOW.slice(0, 4), +NOW.slice(5, 7), 0).getDate()
  eq('a mid-month balance is unwound to the month’s start', F.startingBalance(d), 6000 - (1200 * 5) / daysThisMonth)
}

console.log('\n── F. No balance anywhere ──')
{
  const d = base({
    recurring: [line({ id: 'r1', label: 'Salary', amount: 3000, flow: 'income', category: 'Income' })],
    transactions: [tx({ date: `${M(-1)}-01`, description: 'Salary', amount: 3000, category: 'Income' })],
  })
  eq('no anchor to project from', F.hasBalanceAnchor(d), false)
  eq('totalBalance', F.totalBalance(d), 0)
  // An account that exists but has never been given a figure is still no anchor.
  const tracked = base({ ...d, accounts: [{ id: 'a1', name: 'S-Bank', balance: 0, asOf: '', tracked: true }] })
  eq('a tracked account awaiting its first statement is not an anchor', F.hasBalanceAnchor(tracked), false)
}

console.log("\n── G. A statement's closing balance is the next month's opening one ──")
{
  const plan = [
    line({ id: 'r1', label: 'Salary', amount: 3000, flow: 'income', category: 'Income' }),
    line({ id: 'r2', label: 'Rent', amount: 2000, flow: 'expense', category: 'Housing' }),
  ]
  const lastMonth = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: endOf(-1), tracked: true }],
    recurring: plan,
  })
  eq('anchor is the month after the statement', F.anchorMonth(lastMonth), NOW)
  eq('last month’s closing balance opens this month untouched', F.startingBalance(lastMonth), 8000)

  const threeBack = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: endOf(-3), tracked: true }],
    recurring: plan,
  })
  eq('a three-month-old statement rolls two months of plan', F.startingBalance(threeBack), 8000 + 2000)

  // The same statement, but those two months have since been imported: the roll
  // uses what really happened rather than the plan.
  const withActuals = base({
    ...threeBack,
    transactions: [
      tx({ date: `${M(-2)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-2)}-02`, description: 'Rent', amount: -2000, category: 'Housing' }),
      tx({ date: `${M(-2)}-09`, description: 'Blowout', amount: -900, category: 'Food' }),
    ],
  })
  eq('an imported month rolls on its real figures', F.startingBalance(withActuals), 8000 + 100 + 1000)

  const applied = base({ recurring: plan })
  F.applyStatementBalance(applied, { closingBalance: 8623.46, asOf: endOf(-1) })
  eq('an import creates the tracked account', applied.accounts.length, 1)
  eq('… and sets it to the closing figure', applied.accounts[0].balance, 8623.46)
  F.applyStatementBalance(applied, { closingBalance: 100, asOf: endOf(-4) })
  eq('an older statement cannot rewind it', applied.accounts[0].balance, 8623.46)
}

console.log('\n── H. The ledger runs continuously through today ──')
{
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: endOf(-1), tracked: true }],
    recurring: [
      line({ id: 'r1', label: 'Salary', amount: 3000, flow: 'income', category: 'Income' }),
      line({ id: 'r2', label: 'Rent', amount: 2000, flow: 'expense', category: 'Housing' }),
      line({ id: 'r3', label: 'Provisioning', amount: 300, flow: 'expense', category: 'Savings' }),
    ],
    transactions: [
      tx({ date: `${M(-2)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-2)}-02`, description: 'Rent', amount: -2000, category: 'Housing' }),
      tx({ date: `${M(-1)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-1)}-02`, description: 'Rent', amount: -2000, category: 'Housing' }),
    ],
  })
  const led = F.buildLedger(d)
  const now = led.find((p) => p.month === NOW)
  const start = F.startingBalance(d)
  eq('the ledger reaches back to the first imported month', led[0].month, M(-2))
  eq('past months are marked as actual', led[0].actual, true)
  eq('this month is the plan again', now.actual, false)
  eq('this month ends at the anchored balance plus its net', now.balance, start + now.net)
  let continuous = true
  for (let i = 1; i < led.length; i++) {
    if (Math.abs(led[i].balance - (led[i - 1].balance + led[i].net)) > 0.005) continuous = false
  }
  ok('every row is the one before it plus that month’s net', continuous)
  eq('provisioning does not drain the projection', now.expenses, 2000)
  eq('… it is reported alongside', now.setAside, 300)
}

console.log('\n── I. The track record agrees with the money dates ──')
{
  const d = base({
    recurring: [
      line({ id: 'r1', label: 'Salary', amount: 3000, flow: 'income', category: 'Income' }),
      line({ id: 'r2', label: 'Rent', amount: 2000, flow: 'expense', category: 'Housing' }),
    ],
    transactions: [
      tx({ date: `${M(-2)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-2)}-02`, description: 'Rent', amount: -2000, category: 'Housing' }),
      tx({ date: `${M(-1)}-01`, description: 'Salary', amount: 3000, category: 'Income' }),
      tx({ date: `${M(-1)}-02`, description: 'Rent', amount: -2000, category: 'Housing' }),
      tx({ date: `${M(-1)}-11`, description: 'Transfer out', amount: -500, category: 'Internal' }),
    ],
  })
  const h = F.computeHistory(d)
  eq('a month per import, oldest first', h.map((p) => p.month).join(','), `${M(-2)},${M(-1)}`)
  eq('actual net matches the money date', h[1].actualNet, F.computeReview(d, M(-1)).net)
  eq('internal transfers stay out of it', h[1].actualNet, 1000)
  eq('planned net comes from the plan', h[1].plannedNet, 1000)
  eq('the cumulative track adds up', h[1].cumulativeActual, h[0].actualNet + h[1].actualNet)
}

console.log('\n── J. What to move into savings, and whether it is really there ──')
{
  const d = base({
    accounts: [{ id: 'flex', name: 'Flexible', balance: 1500, asOf: endOf(-1) }],
    provisionAccountId: 'flex',
    provisions: [
      // Due in three months: a third of what's left, this month.
      { id: 'p1', label: 'Taxes', category: 'Taxes', targetAmount: 3600, dueDate: `${M(3)}-20`, createdAt: '2020-01-01' },
      // Date already gone: it stops asking rather than running a catch-up tab.
      { id: 'p2', label: 'Old MOT', category: 'Transport', targetAmount: 400, dueDate: `${M(-2)}-10`, createdAt: '2020-01-01' },
      // Never given a date: it can't be paced, so it is listed apart.
      { id: 'p3', label: 'Someday', category: 'Other', targetAmount: 900, createdAt: '2020-01-01' },
    ],
    transactions: [
      tx({
        date: `${M(-1)}-08`,
        description: 'To flexible',
        amount: -600,
        category: 'Savings',
        provisionAllocations: [{ provisionId: 'p1', amount: 600, role: 'contribution' }],
      }),
    ],
  })
  const plan = U.fundingPlan(d, M(1), `${NOW}-15`)
  eq('one line to pace', plan.lines.length, 1)
  eq('… and it is the tax bill', plan.lines[0].id, 'p1')
  eq('spread over the months left', plan.total, 1500)
  eq('the passed date has lapsed, not accumulated', plan.lapsed.map((l) => l.id).join(','), 'p2')
  eq('the undated one is listed apart', plan.undated.map((l) => l.id).join(','), 'p3')
  ok('nothing lapsed or undated is in the total', plan.total === 1500)

  const pots = U.potsCheck(d)
  eq('the pots hold', pots.total, 600)
  eq('the account holding them', pots.accountName, 'Flexible')
  eq('… has 900 nobody has claimed', pots.difference, 900)
}

console.log('\n── K. Allocations that can’t be true are put right on load ──')
{
  const d = base({
    provisions: [{ id: 'p1', label: 'Taxes', category: 'Taxes', targetAmount: 3600, createdAt: '2020-01-01' }],
    transactions: [
      // Split further than the transaction went: €150 across a €100 transfer.
      tx({
        date: `${M(-1)}-08`,
        description: 'Over-split',
        amount: -100,
        category: 'Savings',
        provisionAllocations: [
          { provisionId: 'p1', amount: 80, role: 'contribution' },
          { provisionId: 'emergency-fund', amount: 70, role: 'contribution' },
        ],
      }),
      // Earmarked for a pot that no longer exists.
      tx({
        date: `${M(-1)}-09`,
        description: 'Ghost pot',
        amount: -200,
        category: 'Savings',
        provisionAllocations: [{ provisionId: 'gone', amount: 200, role: 'contribution' }],
      }),
      // Untouched: within its amount, pointing somewhere real.
      tx({
        date: `${M(-1)}-10`,
        description: 'Good split',
        amount: -300,
        category: 'Savings',
        provisionAllocations: [{ provisionId: 'p1', amount: 300, role: 'contribution' }],
      }),
      // The pre-split single link, which has to survive as one allocation.
      tx({
        date: `${M(-1)}-11`,
        description: 'Legacy link',
        amount: -50,
        category: 'Savings',
        provisionId: 'p1',
        provisionRole: 'contribution',
        provisionAmount: 50,
      }),
    ],
  })
  S.repairAllocations(d)
  const [over, ghost, good, legacy] = d.transactions
  eq('the over-split is trimmed to what moved', P.allocatedTotal(over), 100)
  eq('… taking the allocations in order', over.provisionAllocations.map((a) => a.amount).join(','), '80,20')
  eq('the ghost allocation is dropped', P.allocatedTotal(ghost), 0)
  ok('… leaving nothing behind', ghost.provisionAllocations === undefined)
  eq('a sound split is left alone', P.allocatedTotal(good), 300)
  eq('the legacy single link becomes one allocation', P.allocatedTotal(legacy), 50)
  ok('… and the old fields are cleared', legacy.provisionId === undefined)
  eq('the pot now holds only what is real', P.provisionStatus(d, d.provisions[0]).funded, 430)
  // Repairing twice must not keep shaving money off.
  S.repairAllocations(d)
  eq('running it again changes nothing', P.provisionStatus(d, d.provisions[0]).funded, 430)
}

console.log('\n── M. Rolling a recorded balance forward, day by day ──')
{
  const plan = [
    line({ id: 'r1', label: 'Salary', amount: 3100, flow: 'income', category: 'Income' }),
    line({ id: 'r2', label: 'Rent', amount: 1100, flow: 'expense', category: 'Housing' }),
  ]
  const days = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()

  // 1. A statement closing on the last day of last month opens this one exactly.
  const clean = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: endOf(-1), tracked: true }],
    recurring: plan,
  })
  eq('a month-end statement needs no roll at all', F.startingBalance(clean), 8000)

  // 2. A statement closing mid-month, with that month imported: the tail of the
  //    month is read off the transactions themselves, not estimated.
  const midImported = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: `${M(-1)}-15`, tracked: true }],
    recurring: plan,
    transactions: [
      tx({ date: `${M(-1)}-03`, description: 'Salary', amount: 3100, category: 'Income' }),
      tx({ date: `${M(-1)}-10`, description: 'Rent', amount: -1100, category: 'Housing' }),
      // After the statement date — the only part the balance does not contain.
      tx({ date: `${M(-1)}-20`, description: 'Car repair', amount: -640, category: 'Transport' }),
      tx({ date: `${M(-1)}-27`, description: 'Refund', amount: 90, category: 'Shopping' }),
    ],
  })
  eq('only what happened after the statement is added', F.startingBalance(midImported), 8000 - 640 + 90)

  // 3. Same statement, nothing imported: the plan covers the tail by days.
  const midPlanned = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: `${M(-1)}-15`, tracked: true }],
    recurring: plan,
  })
  eq(
    'with nothing imported the plan fills the tail pro rata',
    F.startingBalance(midPlanned),
    8000 + (2000 * (days(M(-1)) - 15)) / days(M(-1)),
  )

  // 4. Money set aside never leaves the accounts the balance covers, so it must
  //    not move the roll either.
  const withSetAside = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: `${M(-1)}-15`, tracked: true }],
    recurring: plan,
    provisions: [{ id: 'p1', label: 'Taxes', category: 'Taxes', targetAmount: 3600, createdAt: '2020-01-01' }],
    transactions: [
      tx({ date: `${M(-1)}-20`, description: 'Car repair', amount: -640, category: 'Transport' }),
      tx({
        date: `${M(-1)}-22`,
        description: 'To flexible',
        amount: -500,
        category: 'Savings',
        provisionAllocations: [{ provisionId: 'p1', amount: 500, role: 'contribution' }],
      }),
      tx({ date: `${M(-1)}-24`, description: 'Between my accounts', amount: -900, category: 'Internal' }),
    ],
  })
  eq('setting money aside does not move the balance', F.startingBalance(withSetAside), 8000 - 640)

  // 5. A balance typed part-way through this month is unwound to the month's
  //    start, so the forecast doesn't count those days twice.
  const today = `${NOW}-12`
  const typedToday = base({
    accounts: [{ id: 'a1', name: 'Revolut', balance: 5000, asOf: today }],
    recurring: plan,
    transactions: [
      tx({ date: `${NOW}-02`, description: 'Salary', amount: 3100, category: 'Income' }),
      tx({ date: `${NOW}-06`, description: 'Rent', amount: -1100, category: 'Housing' }),
    ],
  })
  eq('the days already lived through come back out', F.startingBalance(typedToday), 5000 - 2000)
  eq('… and what is held today is still what was typed', F.balanceToday(typedToday), 5000)

  // 6. The ledger's last settled row lands on the recorded balance.
  const led = F.buildLedger(
    base({
      accounts: [{ id: 'a1', name: 'S-Bank', balance: 8000, asOf: endOf(-1), tracked: true }],
      recurring: plan,
      transactions: [
        tx({ date: `${M(-1)}-03`, description: 'Salary', amount: 3100, category: 'Income' }),
        tx({ date: `${M(-1)}-10`, description: 'Rent', amount: -1100, category: 'Housing' }),
      ],
    }),
  )
  eq('the ledger ends last month on the statement figure', led.find((p) => p.month === M(-1)).balance, 8000)

  // 7. No balance anywhere: nothing to roll, and nothing invented.
  eq('nothing recorded rolls to nothing', F.balanceToday(base({ recurring: plan })), 0)
}

console.log('\n── L. The headline chart: six months back, twelve forward ──')
{
  const txs = []
  for (let i = 6; i >= 1; i--) {
    const m = M(-i)
    txs.push(tx({ date: `${m}-01`, description: 'Salary', amount: 4200, category: 'Income' }))
    txs.push(tx({ date: `${m}-03`, description: 'Rent', amount: -1800, category: 'Housing' }))
    txs.push(tx({ date: `${m}-09`, description: 'Groceries', amount: -600, category: 'Food' }))
  }
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 9400, asOf: endOf(-1), tracked: true }],
    recurring: [
      line({ id: 'r1', label: 'Salary', amount: 4200, flow: 'income', category: 'Income', group: 'Income' }),
      line({ id: 'r2', label: 'Rent', amount: 1800, flow: 'expense', category: 'Housing', group: 'Fixed monthly' }),
      line({ id: 'r3', label: 'Groceries', amount: 500, flow: 'expense', category: 'Food', group: 'Variable' }),
    ],
    transactions: txs,
  })
  const s = F.buildSummary(d, 6, 12)
  eq('eighteen months in all', s.length, 18)
  eq('starts six months back', s[0].month, M(-6))
  eq('ends eleven months ahead', s[17].month, M(11))
  eq('the six settled months are marked actual', s.filter((p) => p.actual).length, 6)
  eq('the forward half is projected', s.filter((p) => p.projected).length, 11)

  const past = s[0]
  const future = s[17]
  eq('a settled month carries what was planned', past.plannedIncome, 4200)
  eq('… including planned spending', past.plannedExpenses, 2300)
  ok('a future month carries no second plan line', future.plannedIncome === undefined)

  // The regression this guards: rent read as fixed in the projected half and
  // variable in the settled half, because only the plan side knew the section.
  eq('rent is fixed in the settled half', past.fixedExpenses, 1800)
  eq('… and fixed in the projected half too', future.fixedExpenses, 1800)
  eq('groceries stay variable in both', `${past.variableExpenses}/${future.variableExpenses}`, '600/500')

  let continuous = true
  for (let i = 1; i < s.length; i++) {
    if (Math.abs(s[i].balance - (s[i - 1].balance + s[i].net)) > 0.005) continuous = false
  }
  ok('the balance runs continuously across the join', continuous)
  const nowPoint = s.find((p) => p.month === NOW)
  eq('and meets the anchored balance at today', nowPoint.balance, F.startingBalance(d) + nowPoint.net)
}

console.log('\n── N. Every surface reads the plan the same way ──')
{
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 9400, asOf: endOf(-1), tracked: true }],
    recurring: [
      line({ id: 'r1', label: 'Salary', amount: 4200, flow: 'income', category: 'Income', group: 'Income' }),
      line({ id: 'r2', label: 'Rent', amount: 1800, flow: 'expense', category: 'Housing', group: 'Fixed monthly' }),
      line({ id: 'r3', label: 'Groceries', amount: 520, flow: 'expense', category: 'Food', group: 'Variable' }),
      // The line that used to be counted as spending in the planner and as
      // money kept everywhere else.
      line({ id: 'r4', label: 'Tax provisioning', amount: 600, flow: 'expense', category: 'Savings', group: 'Provisions' }),
    ],
  })
  const f = F.buildForecast(d, 1)[0]
  // What the planner's header adds up, line by line, the way the page does it.
  const planner = d.recurring.reduce(
    (acc, it) => {
      const amt = F.itemAmountForMonth(it, NOW)
      if (it.flow === 'income') acc.income += amt
      else if (F.isPlannedSetAside(it)) acc.setAside += amt
      else acc.expenses += amt
      return acc
    },
    { income: 0, expenses: 0, setAside: 0 },
  )
  eq('the planner and the forecast agree on income', planner.income, f.income)
  eq('… on spending', planner.expenses, f.expenses)
  eq('… and on what is set aside', planner.setAside, f.setAside)
  eq('provisioning is not spending', f.expenses, 2320)
  eq('net result is what the month gains', f.netResult, 1280)
  eq('the balance change keeps what was set aside', f.net, 1880)
  eq('the two nets differ by exactly the set-aside', f.net - f.netResult, f.setAside)

  // The money date's "vs plan" column reads the same plan.
  const r = F.computeReview(d, NOW)
  eq('the money date plans the same spending', r.plannedExpenses, f.expenses)
  eq('… the same set-aside', r.plannedSetAside, f.setAside)
  eq('… and the same net result', r.plannedNet, f.netResult)
}

console.log(
  `\n${fails === 0 ? `ALL ${checks} CHECKS PASSED` : `${fails} of ${checks} CHECKS FAILED`}`,
)
await server.close()
process.exit(fails === 0 ? 0 : 1)
