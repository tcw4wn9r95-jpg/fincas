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
const C = await server.ssrLoadModule('/src/lib/categorize.ts')
const fmt = await server.ssrLoadModule('/src/lib/format.ts')
const PA = await server.ssrLoadModule('/src/lib/parse.ts')
const MO = await server.ssrLoadModule('/src/lib/month.ts')
const EV = await server.ssrLoadModule('/src/lib/events.ts')

const NOW = fmt.currentMonth()
const round = (n) => Math.round(n * 100) / 100
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

console.log('\n── P. A credit card: charged when spent, settled without spending again ──')
{
  // Last month: €900 charged to the card, nothing paid yet. This month: the
  // bill is paid from the current account, and €300 more is charged.
  const cash = { id: 'cash', name: 'S-Bank', balance: 5000, asOf: endOf(0), tracked: true }
  const card = { id: 'card', name: 'Visa', balance: 0, asOf: `${M(-2)}-01`, kind: 'card' }
  const d = base({
    accounts: [cash, card],
    transactions: [
      tx({ date: `${M(-1)}-04`, description: 'Salary', amount: 4000, category: 'Income', accountId: 'cash' }),
      tx({ date: `${M(-1)}-06`, description: 'Big shop', amount: -600, category: 'Shopping', accountId: 'card' }),
      tx({ date: `${M(-1)}-19`, description: 'Restaurant', amount: -300, category: 'Dining', accountId: 'card' }),
      tx({ date: `${NOW}-02`, description: 'Salary', amount: 4000, category: 'Income', accountId: 'cash' }),
      tx({ date: `${NOW}-03`, description: 'Pago tarjeta de credito', amount: -900, category: 'Card payment', accountId: 'cash' }),
      tx({ date: `${NOW}-08`, description: 'Petrol', amount: -300, category: 'Transport', accountId: 'card' }),
    ],
  })

  // The month the charges happened owns the spending.
  const last = F.computeReview(d, M(-1))
  eq('card charges are spending the month they happen', last.expenses, 900)
  eq('net result carries them', last.netResult ?? last.net, 3100)
  eq('the card owed 900 at the end of that month', -F.accountBalance(d, card, endOf(-1)), 900)

  // The month the bill is paid owns none of it.
  const nowR = F.computeReview(d, NOW)
  eq('settling the bill is not spending', nowR.expenses, 300)
  eq('… and the payment shows as money moved, not spent', nowR.excludedOut, 900)
  eq('this month’s net result is untouched by it', nowR.net, 3700)

  // The debt closes as the payment lands, and reopens with the new charge.
  eq('the payment closes the gap', -F.accountBalance(d, card, `${NOW}-03`), 0)
  eq('… and later charges reopen it', -F.accountBalance(d, card, `${NOW}-31`), 300)
  eq('card debt is reported as a positive figure', F.cardDebt(d), 300)

  // Liquidity: what you hold, less what you owe.
  eq('the total nets the debt off the cash', F.totalBalance(d), 5000 - 300)
  eq('a card is never the forecast’s anchor', F.hasBalanceAnchor(base({ accounts: [card] })), false)
  eq('… while a cash account is', F.hasBalanceAnchor(d), true)

  // The identity the whole thing rests on: over any month, the change in what
  // you hold less what you owe is exactly income minus expenses.
  const start = F.accountBalance(d, card, endOf(-1)) + 0
  const end = F.accountBalance(d, card, endOf(0))
  eq('the card moves by charges less payments', round(end - start), round(900 - 300))

  // Two cards: a payment has to say which one it settles, or it settles none.
  const amex = { id: 'amex', name: 'Amex', balance: 0, asOf: `${M(-2)}-01`, kind: 'card' }
  const two = base({
    accounts: [cash, card, amex],
    transactions: [
      tx({ date: `${M(-1)}-06`, description: 'Big shop', amount: -600, category: 'Shopping', accountId: 'card' }),
      tx({ date: `${M(-1)}-14`, description: 'Flights', amount: -140, category: 'Travel', accountId: 'amex' }),
      tx({ date: `${NOW}-03`, description: 'Pago tarjeta', amount: -600, category: 'Card payment', accountId: 'cash' }),
    ],
  })
  eq('an unaimed payment settles neither card', -F.accountBalance(two, card), 600)
  eq('… nor the other one', -F.accountBalance(two, amex), 140)
  eq('and the debt still stands at the full amount', F.cardDebt(two), 740)

  const aimed = base({
    ...two,
    transactions: two.transactions.map((t) =>
      t.category === 'Card payment' ? { ...t, cardAccountId: 'card' } : t,
    ),
  })
  eq('naming the card closes that one', -F.accountBalance(aimed, card), 0)
  eq('… and leaves the other alone', -F.accountBalance(aimed, amex), 140)

  // The breakdown a card's row shows its work with — this is what answers "why
  // is this number what it is" without reverse-engineering the transactions.
  const activity = F.cardActivity(two, card)
  eq('charged, read back out', activity.charged, 600)
  eq('paid, read back out — zero, since it was never aimed here', activity.paid, 0)
  const activityAimed = F.cardActivity(aimed, card)
  eq('once aimed, the payment shows in the breakdown too', activityAimed.paid, 600)

  // Categorisation reaches for it on its own.
  eq('a card payment is recognised on sight', C.categorize('PAGO TARJETA DE CREDITO', -900), 'Card payment')
  eq('… in English too', C.categorize('CREDIT CARD AUTOPAY', -900), 'Card payment')
  ok('and it never counts as cash flow', C.NON_CASHFLOW.has('Card payment'))
}

console.log('\n── Q. A card statement echoes its own payment — it must not count twice ──')
{
  // A credit card statement typically shows the payment that landed alongside
  // the new charges, worded exactly like the cash side ("payment received —
  // thank you"). Importing both statements for the month is the normal
  // workflow, not a mistake, so both naturally end up staged.
  const cash = { id: 'cash', name: 'S-Bank', balance: 5000, asOf: endOf(0), tracked: true }
  const card = { id: 'card', name: 'Visa', balance: -300, asOf: `${M(-1)}-01`, kind: 'card' }
  const d = base({
    accounts: [cash, card],
    transactions: [
      // The cash side: the real transfer, the source of truth for the payment.
      tx({
        date: `${M(0)}-03`,
        description: 'Pago tarjeta de credito',
        amount: -300,
        category: 'Card payment',
        accountId: 'cash',
      }),
      // The card's own statement, echoing the same payment as a credit line —
      // filed against the card because that's the statement it came from.
      tx({
        date: `${M(0)}-03`,
        description: 'Payment received - thank you',
        amount: 300,
        category: 'Card payment',
        accountId: 'card',
      }),
      // New spending since, so the debt isn't just sitting at zero regardless.
      tx({ date: `${M(0)}-10`, description: 'Groceries', amount: -80, category: 'Food', accountId: 'card' }),
    ],
  })
  eq('the payment is counted once, from the cash side', -F.accountBalance(d, card), 80)
  const activity = F.cardActivity(d, card)
  eq('the breakdown agrees: 80 charged', activity.charged, 80)
  eq('… and 300 paid, not 600', activity.paid, 300)
  eq('never reads as credit for money that was never really spare', F.cardDebt(d), 80)

  // The card's echo, on its own with no cash-side line at all, must do nothing —
  // it is not a second, independent payment.
  const echoOnly = base({
    accounts: [cash, card],
    transactions: [d.transactions[1], d.transactions[2]],
  })
  eq('the echo alone settles nothing', -F.accountBalance(echoOnly, card), 380)
}

console.log('\n── R. Reading a cardholder’s name off a statement ──')
{
  const N = PA.readCardholderName
  eq('same line, English', N(['Statement period: 01/06 - 30/06', 'Cardholder: John Smith', 'Card ending 4321']), 'John Smith')
  eq('same line, Spanish, all caps', N(['Resumen de cuenta', 'Titular: MARIA GARCIA LOPEZ', 'Tarjeta VISA']), 'Maria Garcia Lopez')
  eq('label alone, name on the next line', N(['Titular de la tarjeta', 'MARIA GARCIA', 'Numero de tarjeta 1234']), 'Maria Garcia')
  eq('"Name on card" wording', N(['Name on card', 'JANE DOE']), 'Jane Doe')
  eq('French', N(['Titulaire de la carte : Pierre Dubois']), 'Pierre Dubois')
  eq('German', N(['Karteninhaber: Anna Schmidt']), 'Anna Schmidt')
  eq('no label anywhere on the statement', N(['Statement date: 01/06/2026', 'New balance: 300.00']), undefined)
  eq('a label with no name following it', N(['Cardholder:', '1234 5678 9012 3456']), undefined)
  eq('a single word is not trusted as a name', N(['Titular: Empresa']), undefined)
  eq('a card number on the label line is not mistaken for one', N(['Cardholder: 4111 1111 1111 1111']), undefined)
  eq('mixed case is left exactly as printed', PA.tidyName('Jean-Paul Dubois'), 'Jean-Paul Dubois')
  eq('shouted capitals are tidied for an account name', PA.tidyName('MARIA-JOSE GARCIA'), 'Maria-Jose Garcia')

  // Plenty of issuers never print a label at all — the name is just the
  // addressee of the letter, sitting above a street line and a postcode.
  eq(
    'a plain postal address, no label anywhere',
    N(['Credit limit: 2,500.00 EUR', 'MARIA GARCIA LOPEZ', '22 Rue de Gasperich', 'L-5826 Hesperange', 'Visa Premier']),
    'Maria Garcia Lopez',
  )
  eq(
    'the exact shape of a real statement — name and street separated by an unrelated line',
    N([
      'For additional repayments, please indicate:',
      'Account :',
      'Reference : 924361803',
      'CASARES SILVA DIEGO FABIAN',
      'Credit limit : 2.500,00 EUR',
      '22 RUE DE GASPERICH',
      'L-5826 HESPERANGE',
      'Visa Premier',
      'Statement dated 26/02/2026 Folio 1',
      'Transaction date Booking date Description Place Currency amount Amount EUR',
      '05/02/2026 06/02/2026 Goldcar OPORTO - OPO Maia, Oporto -117,46',
    ]),
    'Casares Silva Diego Fabian',
  )
  eq(
    'a Spanish postcode reads the same way',
    N(['JUAN PEREZ MARTIN', 'Calle Mayor 10', '28001 Madrid', 'Movimientos de la tarjeta']),
    'Juan Perez Martin',
  )
  eq(
    'a name-shaped product line does not fool it without an address after it',
    N(['Visa Premier', 'Statement dated 26/02/2026 Folio 1', '01/02/2026 Groceries -10.00']),
    undefined,
  )
  eq(
    'a name-shaped merchant row inside the transaction table is never in play',
    N(['Statement date: 01/06/2026', '01/06/2026 Mi Tierra Luxembourg -18.80', 'New balance: 300.00']),
    undefined,
  )
}

console.log('\n── O. A provision that starts later ──')
{
  const p = (over) => ({
    id: 'p1',
    label: 'Car service',
    category: 'Transport',
    targetAmount: 1200,
    dueDate: `${M(6)}-15`,
    createdAt: '2020-01-01',
    ...over,
  })

  // No start date: it started the day it was created.
  const always = base({ provisions: [p({})] })
  eq('an undated start falls back to when it was made', P.provisionStatus(always, always.provisions[0]).startDate, '2020-01-01')
  eq('… and it is asking for money now', P.provisionStatus(always, always.provisions[0]).notStarted, false)
  const nowPlan = U.fundingPlan(always, NOW, `${NOW}-15`)
  eq('so it is in this month’s transfer', nowPlan.lines.map((l) => l.id).join(','), 'p1')
  eq('spread over the six months to its date', nowPlan.total, 200)

  // Starting in three months: dormant until then, and paced over what is left.
  const later = base({ provisions: [p({ startDate: `${M(3)}-01` })] })
  const st = P.provisionStatus(later, later.provisions[0])
  eq('a future start reads as not started', st.notStarted, true)
  eq('… and paces over start-to-due, not now-to-due', st.suggestedMonthly, 400)
  const plan = U.fundingPlan(later, NOW, `${NOW}-15`)
  eq('it asks for nothing this month', plan.total, 0)
  eq('… and is listed as not yet', plan.notYet.map((l) => l.id).join(','), 'p1')
  ok('… out of the lines being funded', plan.lines.length === 0)

  // Once its month arrives it joins the transfer at the paced amount.
  const started = U.fundingPlan(later, M(3), `${NOW}-15`)
  eq('in its own month it joins in', started.lines.map((l) => l.id).join(','), 'p1')
  eq('… for its share of the months left', started.total, 400)
  ok('and nothing is left waiting', started.notYet.length === 0)

  // A start date already behind us changes nothing.
  const begun = base({ provisions: [p({ startDate: `${M(-2)}-01` })] })
  eq('a past start is simply started', P.provisionStatus(begun, begun.provisions[0]).notStarted, false)
  eq('and it funds like any other', U.fundingPlan(begun, NOW, `${NOW}-15`).total, 200)
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

console.log('\n── T. Closing a provision steps it out of the way, without losing it ──')
{
  const closedProv = {
    id: 'closed1',
    label: 'Car repair',
    category: 'Transport',
    targetAmount: 500,
    createdAt: `${M(-6)}-01`,
    closedAt: `${M(0)}-01`,
  }
  const openProv = {
    id: 'open1',
    label: 'Taxes',
    category: 'Taxes',
    targetAmount: 1000,
    dueDate: `${M(1)}-15`,
    createdAt: `${M(-2)}-01`,
  }
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 5000, asOf: endOf(0), tracked: true }],
    provisions: [closedProv, openProv],
    transactions: [
      // Only partly funded before it was closed — it must still not ask for more.
      tx({ id: 'c1', date: `${M(-3)}-10`, description: 'Into car fund', amount: -200, category: 'Savings', accountId: 'a1', provisionId: 'closed1', provisionRole: 'contribution', provisionAmount: 200 }),
    ],
  })

  const statuses = P.allProvisionStatuses(d)
  const closedStatus = statuses.find((s) => s.id === 'closed1')
  eq('a closed provision still carries its closedAt', closedStatus.closedAt, closedProv.closedAt)
  eq('… and its real funded balance', closedStatus.funded, 200)

  const open = P.openProvisionStatuses(d)
  ok('open statuses drop the closed one', !open.some((s) => s.id === 'closed1'))
  ok('… and keep the open one', open.some((s) => s.id === 'open1'))

  const funding = U.fundingPlan(d, M(0), `${M(0)}-15`)
  ok('the closed provision asks for nothing, underfunded or not', !funding.lines.some((l) => l.id === 'closed1') && !funding.settled.some((l) => l.id === 'closed1'))
  ok('the open provision still asks normally', funding.lines.some((l) => l.id === 'open1'))

  const pots = U.potsCheck(d)
  eq('but the money it already holds still counts toward the pots check', pots.provisions, 200)

  const summary = F.financialSummary(d)
  ok('the AI snapshot leaves the closed provision out', !summary.includes('Car repair'))
  ok('… and still lists the open one', summary.includes('Taxes'))
}

console.log('\n── V. The balance chart doesn’t dip twice for a bill a pot already paid ──')
{
  // Three months funding a Taxes provision via a "flexible pot" transfer
  // (Internal, so it never really leaves the tracked total), then the bill
  // lands: the pot's money comes back (Internal) and pays it (a drawdown).
  const txs = []
  for (const n of [-3, -2, -1]) {
    txs.push(tx({ date: `${M(n)}-02`, description: 'Salary', amount: 3000, category: 'Income', accountId: 'a1' }))
    txs.push(tx({ date: `${M(n)}-03`, description: 'Rent', amount: -1800, category: 'Housing', accountId: 'a1' }))
    txs.push(
      tx({
        date: `${M(n)}-05`,
        description: 'To flexible pot',
        amount: -1200,
        category: 'Internal',
        accountId: 'a1',
        provisionAllocations: [{ provisionId: 'p1', amount: 1200, role: 'contribution' }],
      }),
    )
  }
  txs.push(tx({ date: `${M(-1)}-15`, description: 'From flexible pot', amount: 3600, category: 'Internal', accountId: 'a1' }))
  txs.push(
    tx({
      date: `${M(-1)}-16`,
      description: 'Hacienda quarterly tax',
      amount: -3600,
      category: 'Taxes',
      accountId: 'a1',
      provisionAllocations: [{ provisionId: 'p1', amount: 3600, role: 'drawdown' }],
    }),
  )
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 9000, asOf: endOf(-1), tracked: true }],
    provisions: [{ id: 'p1', label: 'Taxes', category: 'Taxes', targetAmount: 3600, dueDate: `${M(-1)}-16`, createdAt: `${M(-3)}-01` }],
    transactions: txs,
  })

  const summary = F.buildSummary(d, 4, 0)
  const [may, jun, jul] = summary.map((p) => p.net)
  eq('a funding month nets salary minus rent, same as any other', may, 1200)
  eq('… every funding month alike', jun, 1200)
  eq('and the month the bill actually lands is not singled out for a second hit', jul, 1200)
  eq('the balance still climbs to the real, statement-confirmed figure', summary[summary.length - 1].balance, 9000)
  eq('… not a crash-and-recover shape along the way', summary[summary.length - 2].balance, 7800)

  const ledger = F.buildLedger(d)
  const ledgerJul = ledger.find((p) => p.month === M(-1))
  eq('the ledger table agrees with the chart', ledgerJul.net, 1200)

  eq('the headline "Total balance" figure is untouched by the smoothing', F.startingBalance(d), 9000)
}

console.log('\n── X. The month in progress: what is left once what is coming is counted ──')
{
  // Mid-month, on the 10th of a 31-day month. Salary has landed, rent has not.
  const today = `${M(0)}-10`
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 4000, asOf: today, tracked: true }],
    recurring: [
      line({ id: 'r1', label: 'Salary', amount: 3000, flow: 'income', category: 'Income' }),
      line({ id: 'r2', label: 'Rent', amount: 1200, flow: 'expense', category: 'Housing' }),
      line({ id: 'r3', label: 'Groceries', amount: 400, flow: 'expense', category: 'Food' }),
      line({ id: 'r4', label: 'Savings', amount: 200, flow: 'expense', category: 'Savings' }),
    ],
    transactions: [
      // Last month, so the rent has a shape and a date to be recognised by, and
      // groceries visibly arrive as many small shops rather than one charge.
      tx({ id: 'p1', date: `${M(-1)}-03`, description: 'Rent', amount: -1200, category: 'Housing', accountId: 'a1' }),
      tx({ id: 'p2', date: `${M(-1)}-06`, description: 'Supermarket', amount: -130, category: 'Food', accountId: 'a1' }),
      tx({ id: 'p3', date: `${M(-1)}-17`, description: 'Supermarket', amount: -140, category: 'Food', accountId: 'a1' }),
      tx({ id: 'i1', date: `${M(0)}-02`, description: 'Salary', amount: 3000, category: 'Income', accountId: 'a1' }),
      tx({ id: 'f1', date: `${M(0)}-04`, description: 'Supermarket', amount: -120, category: 'Food', accountId: 'a1' }),
      // Logged by hand, before any statement carried it.
      tx({ id: 'm1', date: `${M(0)}-08`, description: 'Lunch', amount: -30, category: 'Food', source: 'manual', accountId: 'a1' }),
    ],
  })

  const p = MO.computeMonthPulse(d, M(0), today)
  eq('the month knows how far in it is', p.daysElapsed, 10)
  eq('money in counts what has landed', p.incomeSoFar, 3000)
  eq('… and nothing more is expected once the salary is in', p.incomeExpected, 0)
  eq('spending counts the hand-logged line alongside the imported one', p.spent, 150)

  // Rent is the one planned line nothing has matched.
  eq('the bill still to land is found', p.pending.map((b) => b.label).join(','), 'Rent')
  eq('… at its planned size', p.pendingTotal, 1200)
  eq('… and on the day it landed last month', p.pending[0].typicalDay, 3)
  ok(
    'a variable budget is never a pending bill — it arrives as many small shops, not one charge',
    !p.pending.some((b) => b.category === 'Food'),
  )
  // Still spoken for, though: 1200 of rent plus the 250 of grocery budget left.
  eq('what the plan still expects out covers both', p.committedLeft, 1450)

  // 3000 in − 150 spent − 1450 still expected out − 200 still to set aside.
  eq('free to spend nets off everything still coming', p.freeToSpend, 1200)
  eq('the pots still owed this month are counted against it', p.setAsideLeft, 200)

  const food = p.categories.find((c) => c.category === 'Food')
  eq('a category reports what it has left', food.left, 250)
  eq('… and where even pacing would put it by the 10th', food.paceTarget, round((400 * 10) / 31))

  // ── The same spend, typed and then imported ──
  const doubled = base({
    ...d,
    transactions: [
      ...d.transactions,
      tx({ id: 's1', date: `${M(0)}-08`, description: 'CAFE LISBOA 4471', amount: -30, category: 'Dining', accountId: 'a1' }),
    ],
  })
  const dupes = MO.duplicatePairs(doubled, M(0))
  eq('a hand-logged spend and its imported twin are paired', dupes.length, 1)
  eq('… the typed one is named as the one to drop', dupes[0].manual.id, 'm1')
  eq('… and the statement line as the record to keep', dupes[0].imported.id, 's1')
  ok('a differing amount on the same day is not a pair', MO.duplicatePairs(base({ ...d, transactions: [...d.transactions, tx({ id: 's2', date: `${M(0)}-08`, description: 'Other', amount: -31, category: 'Dining' })] }), M(0)).length === 0)

  // Pace belongs to the everyday half: 1600 planned less the 1200 rent.
  eq('the everyday budget takes the committed bill out of the plan', p.everydayPlan, 400)
  eq('… and out of what has been spent', p.everydaySpent, 150)
  eq('the month is judged on where it will land, not on a straight-line pace', p.projectedMonthEnd, 1600)

  // Housing's 1200 is unspent only because the rent has not posted. Offering it
  // as slack would have the assistant suggest spending the rent.
  const housing = p.categories.find((c) => c.category === 'Housing')
  ok('a category whose plan is a bill is marked committed', housing.committed)
  ok('… while a variable budget is not', !p.categories.find((c) => c.category === 'Food').committed)

  // What the assistant is handed.
  const text = MO.monthPulseText(d, M(0))
  ok('the assistant is told what is still expected out', text.includes('still expects'))
  ok('… and what is free to spend', text.includes('Free to spend'))
  const movable = text.split('\n').find((l) => l.startsWith('Running behind plan')) ?? ''
  ok('unspent grocery budget is offered as movable', movable.includes('Food'))
  ok('an unpaid rent is never offered as movable', !movable.includes('Housing'))
}

console.log('\n── Y. Fixed costs are assumed paid; the rest get a button ──')
{
  const today = `${M(0)}-10`
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 4000, asOf: today, tracked: true }],
    recurring: [
      line({ id: 'r1', label: 'Salary', amount: 3000, flow: 'income', category: 'Income' }),
      line({ id: 'r2', label: 'Car loan', amount: 300, flow: 'expense', category: 'Loans', dayOfMonth: 5 }),
      line({ id: 'r3', label: 'Electricity', amount: 60, flow: 'expense', category: 'Utilities', dayOfMonth: 12 }),
      line({ id: 'r4', label: 'Home insurance', amount: 40, flow: 'expense', category: 'Insurance', dayOfMonth: 20 }),
      line({ id: 'r5', label: 'Netflix', amount: 12, flow: 'expense', category: 'Subscriptions', dayOfMonth: 2 }),
      // Not a fixed cost: rent has to be ticked off by hand.
      line({ id: 'r6', label: 'Rent', amount: 1200, flow: 'expense', category: 'Housing', dayOfMonth: 3 }),
    ],
  })

  const before = MO.computeMonthPulse(d, M(0), today)
  eq('every planned bill starts out waiting', before.pending.length, 5)
  eq(
    'the four fixed-cost categories are the ones marked automatic',
    before.pending.filter((b) => b.autoPaid).map((b) => b.category).sort().join(','),
    'Insurance,Loans,Subscriptions,Utilities',
  )
  ok('rent is not', !before.pending.find((b) => b.label === 'Rent').autoPaid)

  const auto = MO.autoPayTransactions(d, M(0), today)
  eq('only the fixed costs are written in', auto.map((t) => t.description).sort().join(','), 'Car loan,Electricity,Home insurance,Netflix')
  eq('… at their planned size, as money out', auto.reduce((s, t) => s + t.amount, 0), -412)
  eq('… dated the day the plan says they land', auto.find((t) => t.description === 'Electricity').date, `${M(0)}-12`)
  ok('… and marked as standing in for a plan line', auto.every((t) => t.plannedLineId))

  const paid = base({ ...d, transactions: auto })
  const after = MO.computeMonthPulse(paid, M(0), today)
  eq('they stop waiting to be ticked off', after.pending.map((b) => b.label).join(','), 'Rent')
  eq('… and count as spent', after.spent, 412)
  eq('what is free is unchanged — the money was always committed', after.freeToSpend, before.freeToSpend)
  eq('running it again writes nothing', MO.autoPayTransactions(paid, M(0), today).length, 0)

  // The button, on the one bill that has no automatic rule.
  const rentTx = MO.plannedPayment(paid, paid.recurring.find((r) => r.id === 'r6'), M(0))
  eq('marking rent paid dates it to its own day', rentTx.date, `${M(0)}-03`)
  eq('… at the planned amount', rentTx.amount, -1200)
  const allPaid = base({ ...paid, transactions: [...auto, rentTx] })
  ok('nothing is left waiting', MO.computeMonthPulse(allPaid, M(0), today).pending.length === 0)

  // The statement finally arrives, and the real electricity bill is not the
  // guess: two days later and a euro forty more.
  const real = base({
    ...paid,
    transactions: [
      ...auto,
      tx({ id: 'real', date: `${M(0)}-14`, description: 'EDP ENERGIA', amount: -61.4, category: 'Utilities', accountId: 'a1' }),
    ],
  })
  const pairs = MO.duplicatePairs(real, M(0))
  eq('the stand-in is paired with the charge it stood for', pairs.length, 1)
  eq('… named as an assumption rather than something logged', pairs[0].kind, 'assumed')
  eq('… the assumed row being the one to drop', pairs[0].manual.description, 'Electricity')
  eq('… and the statement line the one to keep', pairs[0].imported.id, 'real')

  // The importer files a line by guesswork long before anyone reconciles it, so
  // an incoming charge very often does not yet carry the right category. It
  // still has to be recognised, or the real bill lands beside the stand-in and
  // the month counts it twice.
  const miscategorised = base({
    ...paid,
    transactions: [
      ...auto,
      tx({ id: 'edp', date: `${M(0)}-14`, description: 'EDP ENERGIA', amount: -61.4, category: 'Other', accountId: 'a1' }),
    ],
  })
  const loose = MO.duplicatePairs(miscategorised, M(0))
  eq('a charge filed as Other is still matched to the bill it settles', loose.length, 1)
  eq('… the electricity stand-in being the one to drop', loose[0].manual.description, 'Electricity')

  // But not anything of roughly that size: a restaurant weeks away is not the
  // electricity bill.
  const unrelated = base({
    ...paid,
    transactions: [
      ...auto,
      tx({ id: 'din', date: `${M(0)}-28`, description: 'Restaurant', amount: -55, category: 'Dining', accountId: 'a1' }),
    ],
  })
  eq('an unrelated spend of similar size is left alone', MO.duplicatePairs(unrelated, M(0)).length, 0)
}

console.log('\n── Z. A planned event books its own line, prorated across the months it runs ──')
{
  const ev = {
    id: 'e1',
    label: 'Lisbon trip',
    kind: 'travel',
    // Four days in this month, five in the next: 9 days in all.
    startDate: `${M(0)}-28`,
    endDate: `${M(1)}-05`,
    budget: 900,
    category: 'Travel',
    expenses: [],
    createdAt: `${M(0)}-01`,
  }
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 5000, asOf: endOf(0), tracked: true }],
    events: [ev],
    recurring: [line({ id: 'r1', label: 'Dining out', amount: 200, flow: 'expense', category: 'Dining' })],
    transactions: [
      tx({ id: 'x1', date: `${M(0)}-29`, description: 'Restaurante Lisboa', amount: -120, category: 'Dining', accountId: 'a1', eventId: 'e1' }),
      tx({ id: 'x2', date: `${M(1)}-02`, description: 'Hotel', amount: -300, category: 'Travel', accountId: 'a1', eventId: 'e1' }),
      // Ordinary spending, untagged — must stay in its own category.
      tx({ id: 'x3', date: `${M(0)}-10`, description: 'Local bistro', amount: -40, category: 'Dining', accountId: 'a1' }),
    ],
  })

  eq('the budget splits by the days it runs in each month', EV.eventBudgetForMonth(ev, M(0)), 400)
  eq('… and the rest belongs to the next', EV.eventBudgetForMonth(ev, M(1)), 500)
  eq('the two shares are the whole budget, counted once', EV.eventBudgetForMonth(ev, M(0)) + EV.eventBudgetForMonth(ev, M(1)), 900)
  eq('a month it never touches gets nothing', EV.eventBudgetForMonth(ev, M(-1)), 0)

  const r0 = F.computeReview(d, M(0))
  const row = r0.categories.find((c) => c.eventId === 'e1')
  eq('the event gets a line of its own, named after it', row.category, 'Lisbon trip')
  eq('… budgeted at this month\'s share', row.planned, 400)
  eq('… carrying the spending tagged to it', row.actual, 120)

  // The tagged restaurant must have left Dining, or the month counts it twice.
  const dining = r0.categories.find((c) => c.category === 'Dining')
  eq('tagged spending leaves its ordinary category', dining.actual, 40)
  eq('… so the month total still counts every euro exactly once', r0.expenses, 160)
  eq('and the plan carries the event share on top of the ordinary budget', r0.plannedExpenses, 600)

  // The next month picks up the rest of the trip.
  const r1 = F.computeReview(d, M(1))
  const row1 = r1.categories.find((c) => c.eventId === 'e1')
  eq('the following month books the remaining share', row1.planned, 500)
  eq('… and the spending that happened in it', row1.actual, 300)

  // The event's own screen is unchanged: it still sees the whole trip.
  const status = EV.eventStatus(d, ev, `${M(1)}-10`)
  eq('the event still tallies its whole budget', status.budget, 900)
  eq('… and everything spent on it, across both months', status.spent, 420)

  // Pace is about habits; three days of a trip is not one.
  const p = MO.computeMonthPulse(d, M(0), `${M(0)}-29`)
  eq('the event is out of the day-to-day budget', p.everydayPlan, 200)
  eq('… and out of day-to-day spending', p.everydaySpent, 40)
  ok('its row is never offered as everyday slack', p.categories.find((c) => c.eventId === 'e1').committed)

  // A trip a provision is already saving for is charged to the funding months,
  // so budgeting for it here as well would ask this month to afford it twice.
  const funded = base({
    ...d,
    provisions: [{ id: 'pv', label: 'Lisbon', category: 'Travel', targetAmount: 900, createdAt: `${M(-3)}-01` }],
    events: [{ ...ev, provisionId: 'pv' }],
  })
  const fr = F.computeReview(funded, M(0))
  const frow = fr.categories.find((c) => c.eventId === 'e1')
  eq('a pre-funded event still gets its line', frow.category, 'Lisbon trip')
  eq('… but carries no plan, since the pot already paid for it', frow.planned, 0)
}

console.log('\n── AA. When a plan line next lands ──')
{
  const annual = line({
    id: 'r1', label: 'Home insurance', amount: 900, flow: 'expense', category: 'Insurance',
    cadence: 'annual', startDate: `${M(-9)}-14`,
  })
  const quarterly = line({
    id: 'r2', label: 'Quarterly tax', amount: 1200, flow: 'expense', category: 'Taxes',
    cadence: 'quarterly', startDate: `${M(-1)}-20`,
  })
  const monthly = line({ id: 'r3', label: 'Rent', amount: 1000, flow: 'expense', category: 'Housing' })

  eq('an annual line reports the date it next lands', F.nextOccurrence(annual, M(0)), `${M(3)}-14`)
  eq('a quarterly one, the same way', F.nextOccurrence(quarterly, M(0)), `${M(2)}-20`)
  eq('a monthly line is simply this month', F.nextOccurrence(monthly, M(0)), `${M(0)}-01`)

  // A day the month is too short for lands on its last day rather than rolling over.
  const late = line({ id: 'r4', label: 'Odd', amount: 10, flow: 'expense', category: 'Fees', dayOfMonth: 31 })
  eq('a 31st in a short month clamps to its end', F.nextOccurrence(late, '2027-02'), '2027-02-28')
}

console.log('\n── AB. Every plan line is accounted for, in the month it belongs to ──')
{
  // The four fixed-cost categories are automatic by declaration. History must
  // not be able to talk the app out of it: an insurance line planned monthly
  // against a history of quarterly charges matches nothing, and used to be
  // demoted to a spread budget — never written in, never even listed.
  const awkward = base({
    recurring: [line({ id: 'i1', label: 'Home insurance', amount: 40, flow: 'expense', category: 'Insurance', dayOfMonth: 20 })],
    transactions: [tx({ date: `${M(-1)}-20`, description: 'MAPFRE', amount: -120, category: 'Insurance' })],
  })
  const written = MO.autoPayTransactions(awkward, M(0), `${M(0)}-10`)
  eq('a fixed cost is written in whatever its history looks like', written.map((t) => t.label ?? t.description).join(','), 'Home insurance')
  eq('… at the planned amount', written[0].amount, -40)

  // The same must hold for the other three.
  for (const [cat, label] of [['Loans', 'Car loan'], ['Utilities', 'Water'], ['Subscriptions', 'Spotify']]) {
    const d = base({
      recurring: [line({ id: 'x', label, amount: 30, flow: 'expense', category: cat })],
      transactions: [tx({ date: `${M(-1)}-09`, description: 'odd', amount: -7, category: cat })],
    })
    ok(`${cat} is automatic too, regardless of history`, MO.autoPayTransactions(d, M(0), `${M(0)}-10`).length === 1)
  }

  // A cost that is not due this month is in no figure — and says so.
  const annual = base({
    recurring: [
      line({ id: 'a1', label: 'Home insurance', amount: 900, flow: 'expense', category: 'Insurance', cadence: 'annual', startDate: `${M(-9)}-14` }),
      line({ id: 'a2', label: 'Groceries', amount: 400, flow: 'expense', category: 'Food' }),
    ],
  })
  const p = MO.computeMonthPulse(annual, M(0), `${M(0)}-10`)
  eq('an annual premium costs this month nothing', p.plannedSpend, 400)
  ok('… so it is not written in as paid', MO.autoPayTransactions(annual, M(0), `${M(0)}-10`).length === 0)
  ok('… and not waiting to land either', !p.pending.some((b) => b.category === 'Insurance'))
  eq('… but it is named as coming, with the month it lands', p.upcoming.map((b) => `${b.label}@${b.month}`).join(','), `Home insurance@${M(3)}`)
  eq('… at what it will cost', p.upcoming[0].amount, 900)
  ok('a monthly line is never "upcoming" — it is due now', !p.upcoming.some((b) => b.label === 'Groceries'))

  // Come the month it lands, it stops being upcoming and becomes automatic.
  const due = MO.computeMonthPulse(annual, M(3), `${M(3)}-01`)
  ok('in its own month it is gone from the upcoming list', !due.upcoming.some((b) => b.label === 'Home insurance'))
  eq('… and is written in like any other fixed cost', MO.autoPayTransactions(annual, M(3), `${M(3)}-01`).length, 1)

  ok('the assistant is told what is not due yet', MO.monthPulseText(annual, M(0)).includes('not due this month'))
}

console.log('\n── AC. An assumption you can correct, remove, and have stay removed ──')
{
  const today = `${M(0)}-10`
  const d = base({
    recurring: [line({ id: 'u1', label: 'Electricity', amount: 60, flow: 'expense', category: 'Utilities', dayOfMonth: 12 })],
  })
  const [written] = MO.autoPayTransactions(d, M(0), today)
  const paid = base({ ...d, transactions: [written] })
  eq('the month assumes the bill paid', MO.computeMonthPulse(paid, M(0), today).spent, 60)

  // Removing it has to stick, or deleting it is only ever temporary.
  const removed = base({
    ...d,
    transactions: [],
    autoPaySkips: [`${M(0)}:u1`],
  })
  eq('once removed, it is not assumed again', MO.autoPayTransactions(removed, M(0), today).length, 0)
  eq('… and returns to the list to be ticked off by hand', MO.computeMonthPulse(removed, M(0), today).pending.map((b) => b.label).join(','), 'Electricity')
  eq('… only for the month it was removed from', MO.autoPayTransactions(removed, M(1), `${M(1)}-10`).length, 1)

  // A wrong pairing can be overruled, and the overruling taken back.
  const withReal = base({
    ...d,
    transactions: [
      written,
      tx({ id: 'r', date: `${M(0)}-14`, description: 'EDP', amount: -61.4, category: 'Utilities' }),
    ],
  })
  eq('the stand-in is paired with the real charge', MO.duplicatePairs(withReal, M(0)).length, 1)
  const overruled = base({
    ...withReal,
    transactions: withReal.transactions.map((t) => (t.plannedLineId ? { ...t, notDuplicate: true } : t)),
  })
  eq('saying they are separate stops it being offered', MO.duplicatePairs(overruled, M(0)).length, 0)
  ok('… and the description is left exactly as it was', overruled.transactions.every((t) => !t.description.includes('confirmed separate')))
  const undone = base({
    ...overruled,
    transactions: overruled.transactions.map((t) => ({ ...t, notDuplicate: undefined })),
  })
  eq('clearing the flag brings the pairing back', MO.duplicatePairs(undone, M(0)).length, 1)
}

console.log('\n── AD. Tagging a spend to an event, and the tally that disagrees ──')
{
  const ev = () => ({
    id: 'e1', label: 'Lisbon trip', kind: 'travel',
    startDate: `${M(0)}-10`, endDate: `${M(0)}-14`, budget: 900, category: 'Travel',
    createdAt: `${M(0)}-01`,
    expenses: [
      // Logged at the table, before any statement existed.
      { id: 'x1', date: `${M(0)}-11`, label: 'Dinner', amount: 45, category: 'Dining' },
      { id: 'x2', date: `${M(0)}-12`, label: 'Museum', amount: 20, category: 'Entertainment' },
    ],
  })

  // An exact counterpart retires itself — no question to ask.
  const exact = base({
    events: [ev()],
    transactions: [tx({ id: 't1', date: `${M(0)}-12`, description: 'MUSEU', amount: -20, category: 'Entertainment' })],
  })
  ok('an exact match needs no asking', !EV.nearMatchExpense(exact.events[0], exact.transactions[0]))
  EV.tagTransactionToEvent(exact, 'e1', 't1')
  eq('the line is tagged to the event', exact.transactions[0].eventId, 'e1')
  eq('… and the logged one it answers retires', exact.events[0].expenses.find((x) => x.id === 'x2').matchedTxId, 't1')
  eq('… so the event counts it once', EV.eventStatus(exact, exact.events[0], `${M(0)}-20`).spent, 65)

  // The statement says 47.30 where the tally said 45: close, not equal.
  const off = base({
    events: [ev()],
    transactions: [tx({ id: 't2', date: `${M(0)}-11`, description: 'RESTAURANTE', amount: -47.3, category: 'Dining' })],
  })
  const near = EV.nearMatchExpense(off.events[0], off.transactions[0])
  eq('a near miss is found, to be asked about', near && near.label, 'Dinner')
  EV.tagTransactionToEvent(off, 'e1', 't2')
  ok('tagging alone does not retire it — the disagreement stands', !off.events[0].expenses.find((x) => x.id === 'x1').matchedTxId)
  eq('… so both are counted until the user says', EV.eventStatus(off, off.events[0], `${M(0)}-20`).spent, 112.3)

  // Answering "yes, same spend" retires the tally and the statement wins.
  EV.tagTransactionToEvent(off, 'e1', 't2', 'x1')
  eq('saying they are the same retires the logged line', off.events[0].expenses.find((x) => x.id === 'x1').matchedTxId, 't2')
  eq('… and the real amount is what counts', EV.eventStatus(off, off.events[0], `${M(0)}-20`).spent, 67.3)

  // Something genuinely unrelated is never offered as a match.
  const far = base({
    events: [ev()],
    transactions: [tx({ id: 't3', date: `${M(0)}-11`, description: 'Taxi', amount: -9, category: 'Transport' })],
  })
  ok('a spend of a different size is not a near miss', !EV.nearMatchExpense(far.events[0], far.transactions[0]))
  const late = base({
    events: [ev()],
    transactions: [tx({ id: 't4', date: `${M(0)}-25`, description: 'Dinner elsewhere', amount: -45, category: 'Dining' })],
  })
  ok('nor is the same amount two weeks later', !EV.nearMatchExpense(late.events[0], late.transactions[0]))

  // Untagging releases whatever was standing in for it.
  EV.tagTransactionToEvent(exact, undefined, 't1')
  ok('untagging clears the event', !exact.transactions[0].eventId)
  ok('… and releases the logged line again', !exact.events[0].expenses.find((x) => x.id === 'x2').matchedTxId)
}

console.log('\n── AE. A grocery budget is never a bill waiting to land ──')
{
  const today = `${M(0)}-10`
  // A €150 food budget, and a month gone by that happened to contain one €140
  // shop. That single charge used to make Food look exactly like a bill.
  const d = base({
    recurring: [
      line({ id: 'f1', label: 'Groceries', amount: 150, flow: 'expense', category: 'Food' }),
      line({ id: 'r1', label: 'Rent', amount: 1200, flow: 'expense', category: 'Housing', dayOfMonth: 3 }),
    ],
    transactions: [
      tx({ date: `${M(-1)}-04`, description: 'Big shop', amount: -140, category: 'Food' }),
      tx({ date: `${M(-1)}-18`, description: 'Small shop', amount: -30, category: 'Food' }),
      tx({ date: `${M(-1)}-03`, description: 'Rent', amount: -1200, category: 'Housing' }),
    ],
  })
  const p = MO.computeMonthPulse(d, M(0), today)
  ok('food is not something "still to land"', !p.pending.some((b) => b.category === 'Food'))
  eq('… only the rent is', p.pending.map((b) => b.label).join(','), 'Rent')
  ok('… and its row is not marked as a committed bill', !p.categories.find((c) => c.category === 'Food').committed)
  ok('the rent still is', p.categories.find((c) => c.category === 'Housing').committed)
  eq('so the food budget is what you steer day to day', p.everydayPlan, 150)

  // Every spread category holds, whatever its history looks like.
  for (const cat of ['Food', 'Dining', 'Shopping', 'Entertainment', 'Transport', 'Home expenses', 'Other']) {
    const one = base({
      recurring: [line({ id: 'x', label: cat, amount: 200, flow: 'expense', category: cat })],
      transactions: [tx({ date: `${M(-1)}-05`, description: 'one big one', amount: -205, category: cat })],
    })
    ok(`${cat} is a budget, not a bill`, MO.computeMonthPulse(one, M(0), today).pending.length === 0)
  }

  // A line the user has explicitly grouped as Variable is a budget too.
  const grouped = base({
    recurring: [line({ id: 'g1', label: 'Pocket money', amount: 80, flow: 'expense', category: 'Health', group: 'Variable' })],
  })
  ok('a line grouped Variable is never a bill either', MO.computeMonthPulse(grouped, M(0), today).pending.length === 0)
}

console.log('\n── W. Set aside splits into provisions, investments and savings ──')
{
  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 5000, asOf: endOf(0), tracked: true }],
    provisions: [{ id: 'p1', label: 'Car fund', category: 'Transport', targetAmount: 2000, createdAt: `${M(0)}-01` }],
    recurring: [
      line({ id: 'r1', label: 'Car fund transfer', amount: 300, flow: 'expense', category: 'Transport', group: 'Provisions' }),
      line({ id: 'r2', label: 'Index fund', amount: 200, flow: 'expense', category: 'Investments' }),
      line({ id: 'r3', label: 'Savings top-up', amount: 100, flow: 'expense', category: 'Savings' }),
    ],
    transactions: [
      tx({
        id: 't1', date: `${M(0)}-05`, description: 'To car fund', amount: -300, category: 'Transport', accountId: 'a1',
        provisionAllocations: [{ provisionId: 'p1', amount: 300, role: 'contribution' }],
      }),
      tx({ id: 't2', date: `${M(0)}-06`, description: 'Vanguard', amount: -200, category: 'Investments', accountId: 'a1' }),
      tx({ id: 't3', date: `${M(0)}-07`, description: 'To savings', amount: -100, category: 'Savings', accountId: 'a1' }),
    ],
  })

  const r = F.computeReview(d, M(0))
  eq('provision contributions land in their own bucket', r.setAsideProvisions, 300)
  eq('Investments transactions land in their own bucket', r.setAsideInvestments, 200)
  eq('Savings transactions land in their own bucket', r.setAsideSavings, 100)
  eq('the three sum to the total set aside', round(r.setAsideProvisions + r.setAsideInvestments + r.setAsideSavings), r.setAside)
  eq('planned provisions matches the recurring line', r.plannedSetAsideProvisions, 300)
  eq('planned investments matches the recurring line', r.plannedSetAsideInvestments, 200)
  eq('planned savings matches the recurring line', r.plannedSetAsideSavings, 100)
  eq('the three planned buckets sum to the planned total', round(r.plannedSetAsideProvisions + r.plannedSetAsideInvestments + r.plannedSetAsideSavings), r.plannedSetAside)

  const forecastPoint = F.buildForecast(d, 1)[0]
  eq('the forecast carries the same planned breakdown for provisions', forecastPoint.setAsideProvisions, 300)
  eq('… investments', forecastPoint.setAsideInvestments, 200)
  eq('… and savings', forecastPoint.setAsideSavings, 100)

  const summary = F.buildSummary(d, 0, 1)
  const thisMonth = summary.find((p) => p.month === M(0))
  eq('the summary chart carries the same planned breakdown', thisMonth.setAsideProvisions, 300)
}

console.log('\n── U. Investments is its own category, and it counts as provisioning ──')
{
  eq('a brokerage purchase is read as Investments, not generic Savings', C.categorize('Vanguard brokerage purchase', -500), 'Investments')
  eq('a plain savings top-up still reads as Savings', C.categorize('Monthly savings top-up', -200), 'Savings')

  const d = base({
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 5000, asOf: endOf(0), tracked: true }],
    transactions: [
      tx({ id: 't1', date: `${M(0)}-05`, description: 'To Vanguard', amount: -400, category: 'Investments', accountId: 'a1' }),
    ],
  })
  const r = F.computeReview(d, M(0))
  eq('the whole transfer is kept, not spent', r.setAside, 400)
  eq('so it adds nothing to expenses', r.expenses, 0)
  ok('and it does not show up as its own expense row — same as Savings', !r.categories.some((c) => c.category === 'Investments'))

  // A recurring Investments line groups with the planner's other provisioning,
  // not with day-to-day variable spend.
  const item = line({ id: 'r1', label: 'Index fund', amount: 300, flow: 'expense', category: 'Investments' })
  eq('it groups into the Provisions section of the planner', F.planSection(item), 'Provisions')
  ok('the planner treats it as money set aside, not spending', F.isPlannedSetAside(item))
  ok('… and not as variable spend to pace against', !F.isVariableExpense(item))
}

console.log('\n── S. The assistant reads individual transactions, not just totals ──')
{
  const d = base({
    settings: { apiKey: '', model: 'm', currency: 'EUR', locale: 'en-GB' },
    accounts: [{ id: 'a1', name: 'S-Bank', balance: 100, asOf: endOf(0), tracked: true }],
    transactions: [
      tx({ id: 't1', date: `${M(0)}-05`, description: 'Coffee shop', amount: -4.5, category: 'Food', accountId: 'a1' }),
      // Well outside the ledger's 18-month window — must not appear.
      tx({ id: 't2', date: `${M(-30)}-05`, description: 'Ancient purchase', amount: -9, category: 'Food', accountId: 'a1' }),
    ],
  })
  const ledger = F.transactionLedger(d)
  ok('the recent line is in the ledger', ledger.includes('Coffee shop'))
  ok('an unlabelled account still gets a line', ledger.includes('S-Bank'))
  ok('a transaction outside the window is left out', !ledger.includes('Ancient purchase'))

  const empty = F.transactionLedger(base())
  eq('an empty ledger says so plainly', empty, 'No individual transactions recorded yet.')
}

console.log(
  `\n${fails === 0 ? `ALL ${checks} CHECKS PASSED` : `${fails} of ${checks} CHECKS FAILED`}`,
)
await server.close()
process.exit(fails === 0 ? 0 : 1)
