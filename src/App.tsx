import { useEffect, useState } from 'react'
import { Splash } from './components/Splash'
import { Dashboard } from './components/Dashboard'
import { MoneyDate } from './components/MoneyDate'
import { CurrentMonth } from './components/CurrentMonth'
import { Events } from './components/Events'
import { Insights } from './components/Insights'
import { Chat } from './components/Chat'
import { Plan } from './components/Plan'
import { Settings } from './components/Settings'
import { Logo } from './components/icons'
import {
  IconDashboard,
  IconMoneyDate,
  IconWeek,
  IconEvent,
  IconInsights,
  IconChat,
  IconPlan,
  IconSettings,
  IconMore,
} from './components/icons'
import { classNames } from './lib/format'
import { loadChat, saveChat } from './lib/storage'
import type { ChatMessage } from './lib/types'

type Tab =
  | 'overview'
  | 'this-month'
  | 'money-date'
  | 'events'
  | 'insights'
  | 'assistant'
  | 'plan'
  | 'settings'

export type AssistantSeed = { month?: string; prompt?: string; nonce: number }

interface NavItem {
  id: Tab
  label: string
  icon: typeof IconDashboard
  hint: string
}

// Grouped by what you're actually doing, so eight destinations don't read as one
// undifferentiated list — and so the phone's bottom bar can carry the four you
// reach for by reflex and tuck the rest behind More.
const TRACK: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: IconDashboard, hint: 'Where you stand today' },
  { id: 'this-month', label: 'This month', icon: IconWeek, hint: 'Log spend, track budget' },
  { id: 'money-date', label: 'Money date', icon: IconMoneyDate, hint: 'Reconcile the month' },
  { id: 'events', label: 'Events', icon: IconEvent, hint: 'Trips and parties' },
]

const REST: NavItem[] = [
  { id: 'assistant', label: 'Assistant', icon: IconChat, hint: 'Ask about your money' },
  { id: 'insights', label: 'Insights', icon: IconInsights, hint: 'Trends worth knowing' },
  { id: 'plan', label: 'Plan', icon: IconPlan, hint: 'Income, bills, provisions' },
  { id: 'settings', label: 'Settings', icon: IconSettings, hint: 'Keys, backup, data' },
]

const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Track', items: TRACK },
  { title: 'Understand', items: REST.slice(0, 2) },
  { title: 'Set up', items: REST.slice(2) },
]

export function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [moreOpen, setMoreOpen] = useState(false)
  // The assistant thread lives here rather than inside Chat, so switching tabs
  // (which unmounts it) no longer throws the conversation away. Persisted under
  // its own key so a reload keeps it too.
  const [chat, setChat] = useState<ChatMessage[]>(() => loadChat())
  useEffect(() => {
    saveChat(chat)
  }, [chat])

  // Land at the top of a screen you've just opened. Without this the window
  // keeps the scroll offset from wherever you were, so arriving halfway down —
  // or at the very bottom of a long page — is the norm rather than the
  // exception.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [tab])
  // Context the user asked to discuss — hands the Assistant a month or a
  // ready-made prompt (e.g. a current-month recap).
  const [assistantSeed, setAssistantSeed] = useState<AssistantSeed | null>(null)

  function go(next: Tab) {
    setTab(next)
    setMoreOpen(false)
  }

  function discussMonth(month: string) {
    setAssistantSeed({ month, nonce: Date.now() })
    go('assistant')
  }

  function discussPrompt(prompt: string) {
    setAssistantSeed({ prompt, nonce: Date.now() })
    go('assistant')
  }

  // When you're on a secondary screen, the More button becomes that screen —
  // otherwise the bar would show nothing selected and you'd feel lost.
  const activeSecondary = REST.find((i) => i.id === tab)
  const MoreIcon = activeSecondary?.icon ?? IconMore

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
          <nav className="space-y-5 overflow-y-auto">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <div className="px-3 mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted/80">
                  {group.title}
                </div>
                <div className="space-y-1">
                  {group.items.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => go(id)}
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
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto pt-4 px-2 text-[11px] text-muted leading-relaxed">
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
            {tab === 'overview' && <Dashboard goTo={(t) => go(t)} />}
            {tab === 'this-month' && (
              <CurrentMonth
                onDiscuss={discussPrompt}
                onGoToEvents={() => go('events')}
                onGoToPlan={() => go('plan')}
              />
            )}
            {tab === 'money-date' && (
              <MoneyDate
                onDiscuss={discussMonth}
                onGoToEvents={() => go('events')}
                onGoToPlan={() => go('plan')}
              />
            )}
            {tab === 'events' && <Events />}
            {tab === 'insights' && <Insights goToSettings={() => go('settings')} />}
            {tab === 'assistant' && (
              <Chat
                goToSettings={() => go('settings')}
                seed={assistantSeed}
                messages={chat}
                setMessages={setChat}
              />
            )}
            {tab === 'plan' && <Plan />}
            {tab === 'settings' && <Settings />}
          </main>
        </div>

        {/* More sheet — mobile */}
        {moreOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
            <button
              className="absolute inset-0 bg-ink/30 backdrop-blur-sm animate-fade-in"
              onClick={() => setMoreOpen(false)}
              aria-label="Close menu"
            />
            <div className="relative bg-paper rounded-t-xl2 shadow-lift px-4 pt-4 pb-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))]">
              <div className="h-1 w-10 rounded-full bg-line mx-auto mb-4" />
              <div className="grid grid-cols-2 gap-2">
                {REST.map(({ id, label, icon: Icon, hint }) => (
                  <button
                    key={id}
                    onClick={() => go(id)}
                    className={classNames(
                      'flex items-start gap-3 rounded-xl border p-3.5 text-left transition',
                      tab === id
                        ? 'border-forest bg-forest-tint'
                        : 'border-line hover:bg-forest-tint/50',
                    )}
                  >
                    <Icon width={18} height={18} className="mt-0.5 shrink-0 text-forest" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-[11px] text-muted leading-snug">{hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Bottom nav — mobile */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-line bg-paper/95 backdrop-blur flex justify-around px-1 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          {TRACK.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={classNames(
                'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-medium transition',
                tab === id && !moreOpen ? 'text-forest' : 'text-muted',
              )}
            >
              <Icon width={20} height={20} />
              {label}
            </button>
          ))}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={classNames(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-medium transition',
              activeSecondary || moreOpen ? 'text-forest' : 'text-muted',
            )}
            aria-expanded={moreOpen}
          >
            <MoreIcon width={20} height={20} />
            {activeSecondary?.label ?? 'More'}
          </button>
        </nav>
      </div>
    </>
  )
}
