import { useState } from 'react'
import { Splash } from './components/Splash'
import { Dashboard } from './components/Dashboard'
import { MoneyDate } from './components/MoneyDate'
import { Chat } from './components/Chat'
import { Plan } from './components/Plan'
import { Settings } from './components/Settings'
import { Logo } from './components/icons'
import {
  IconDashboard,
  IconMoneyDate,
  IconChat,
  IconPlan,
  IconSettings,
} from './components/icons'
import { classNames } from './lib/format'

type Tab = 'overview' | 'money-date' | 'assistant' | 'plan' | 'settings'

const NAV: { id: Tab; label: string; icon: typeof IconDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: IconDashboard },
  { id: 'money-date', label: 'Money date', icon: IconMoneyDate },
  { id: 'assistant', label: 'Assistant', icon: IconChat },
  { id: 'plan', label: 'Plan', icon: IconPlan },
  { id: 'settings', label: 'Settings', icon: IconSettings },
]

export function App() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <>
      <Splash />
      <div className="min-h-full lg:flex">
        {/* Sidebar — desktop */}
        <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-line bg-paper/60 px-4 py-6 sticky top-0 h-screen">
          <div className="flex items-center gap-2.5 px-2 mb-8">
            <Logo className="w-9 h-9 rounded-xl shadow-soft" />
            <div>
              <div className="font-serif text-xl leading-none">CasaresSan</div>
              <div className="text-[11px] uppercase tracking-widest text-muted mt-1">
                Finances
              </div>
            </div>
          </div>
          <nav className="space-y-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={classNames(
                  'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  tab === id
                    ? 'bg-forest text-paper shadow-soft'
                    : 'text-muted hover:text-ink hover:bg-forest-tint',
                )}
              >
                <Icon width={18} height={18} />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-auto px-2 text-[11px] text-muted leading-relaxed">
            Private & on-device. Your financial data never leaves your browser.
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0">
          {/* Mobile header */}
          <header className="lg:hidden sticky top-0 z-30 flex items-center gap-2.5 border-b border-line bg-canvas/90 backdrop-blur px-4 py-3">
            <Logo className="w-8 h-8 rounded-lg" />
            <span className="font-serif text-lg">CasaresSan Finances</span>
          </header>

          <main className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 pb-24 lg:pb-10 max-w-5xl mx-auto">
            {tab === 'overview' && <Dashboard goTo={(t) => setTab(t)} />}
            {tab === 'money-date' && <MoneyDate />}
            {tab === 'assistant' && <Chat goToSettings={() => setTab('settings')} />}
            {tab === 'plan' && <Plan />}
            {tab === 'settings' && <Settings />}
          </main>
        </div>

        {/* Bottom nav — mobile */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-paper/95 backdrop-blur flex justify-around px-1 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={classNames(
                'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-medium transition',
                tab === id ? 'text-forest' : 'text-muted',
              )}
            >
              <Icon width={20} height={20} />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </>
  )
}
