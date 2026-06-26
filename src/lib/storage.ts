import type { AppData, Settings } from './types'
import { todayISO, uid, currentMonth, addMonths } from './format'

const STORAGE_KEY = 'fincas.data.v1'
export const DATA_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'claude-opus-4-8',
  currency: 'USD',
  locale: 'en-US',
  name: '',
  googleClientId: '',
}

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    recurring: [],
    transactions: [],
    goals: [],
    categoryBudgets: {},
    updatedAt: new Date().toISOString(),
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as AppData
    // Merge in any new default settings keys without clobbering saved ones.
    return {
      ...emptyData(),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    }
  } catch {
    return emptyData()
  }
}

export function saveData(data: AppData): void {
  const next = { ...data, updatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function clearData(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// ── Backup / restore (the "Google Drive or device" path) ─────────────
// We never sync to a server. The user exports a JSON file they can keep
// on disk or drop into their own Google Drive, and re-import it anywhere.

export function exportData(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `casaressan-finances-backup-${todayISO()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importData(file: File): Promise<AppData> {
  const text = await file.text()
  const parsed = JSON.parse(text) as AppData
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
    throw new Error('That file does not look like a CasaresSan Finances backup.')
  }
  return {
    ...emptyData(),
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    updatedAt: new Date().toISOString(),
  }
}

// ── Demo data — lets a first-time user see the app come alive ─────────

export function demoData(): AppData {
  const base = emptyData()
  const m = currentMonth()
  const prev = addMonths(m, -1)
  const prev2 = addMonths(m, -2)

  base.settings.name = 'Sample'
  base.accounts = [
    { id: uid(), name: 'Checking', balance: 8400, asOf: todayISO() },
    { id: uid(), name: 'Savings', balance: 21500, asOf: todayISO() },
  ]
  base.recurring = [
    { id: uid(), label: 'Salary', amount: 5200, flow: 'income', cadence: 'monthly', category: 'Income', startDate: todayISO(), dayOfMonth: 1 },
    { id: uid(), label: 'Freelance', amount: 800, flow: 'income', cadence: 'monthly', category: 'Income', startDate: todayISO(), dayOfMonth: 20 },
    { id: uid(), label: 'Rent', amount: 1850, flow: 'expense', cadence: 'monthly', category: 'Housing', startDate: todayISO(), dayOfMonth: 1 },
    { id: uid(), label: 'Groceries', amount: 600, flow: 'expense', cadence: 'monthly', category: 'Food', startDate: todayISO(), dayOfMonth: 5 },
    { id: uid(), label: 'Utilities', amount: 180, flow: 'expense', cadence: 'monthly', category: 'Utilities', startDate: todayISO(), dayOfMonth: 8 },
    { id: uid(), label: 'Subscriptions', amount: 65, flow: 'expense', cadence: 'monthly', category: 'Subscriptions', startDate: todayISO(), dayOfMonth: 12 },
    { id: uid(), label: 'Transport', amount: 140, flow: 'expense', cadence: 'monthly', category: 'Transport', startDate: todayISO(), dayOfMonth: 3 },
    { id: uid(), label: 'Insurance', amount: 720, flow: 'expense', cadence: 'quarterly', category: 'Insurance', startDate: todayISO(), dayOfMonth: 15 },
  ]
  base.categoryBudgets = {
    Housing: 1850,
    Food: 600,
    Utilities: 180,
    Subscriptions: 65,
    Transport: 140,
    Dining: 250,
    Shopping: 200,
  }
  base.goals = [
    { id: uid(), label: 'Emergency fund', target: 30000, saved: 21500, targetDate: addMonths(m, 10) + '-01' },
    { id: uid(), label: 'Trip to Japan', target: 6000, saved: 1800, targetDate: addMonths(m, 8) + '-01' },
  ]

  const tx = (month: string, day: number, desc: string, amount: number, category: string) => ({
    id: uid(),
    date: `${month}-${String(day).padStart(2, '0')}`,
    description: desc,
    amount,
    category,
    source: 'csv' as const,
    month,
  })
  base.transactions = [
    ...[prev2, prev].flatMap((mm) => [
      tx(mm, 1, 'Salary', 5200, 'Income'),
      tx(mm, 20, 'Freelance invoice', 800, 'Income'),
      tx(mm, 1, 'Rent', -1850, 'Housing'),
      tx(mm, 5, 'Whole Foods', -210, 'Food'),
      tx(mm, 11, 'Trader Joes', -160, 'Food'),
      tx(mm, 18, 'Costco', -240, 'Food'),
      tx(mm, 8, 'Electric + water', -180, 'Utilities'),
      tx(mm, 12, 'Netflix + Spotify', -65, 'Subscriptions'),
      tx(mm, 3, 'Metro card', -140, 'Transport'),
      tx(mm, 14, 'Dinner out', -88, 'Dining'),
      tx(mm, 22, 'Amazon', -130, 'Shopping'),
    ]),
  ]
  return base
}
