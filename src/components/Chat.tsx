import { useEffect, useRef, useState } from 'react'
import { useData } from '../store'
import { askClaude, hasApiKey } from '../lib/claude'
import type { ChatMessage } from '../lib/types'
import { IconSend, IconLock } from './icons'
import { Logo } from './icons'
import { Markdown } from './Markdown'

const SUGGESTIONS = [
  'What should I do about expenses coming up next month?',
  'Where am I overspending versus my plan?',
  'How long will my savings last if my income stopped?',
  'Can I afford to put more toward my goals?',
]

export function Chat({ goToSettings }: { goToSettings: () => void }) {
  const { data } = useData()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const keyed = hasApiKey(data)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, draft])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setError('')
    const next = [...messages, { role: 'user' as const, content: trimmed }]
    setMessages(next)
    setInput('')
    setStreaming(true)
    setDraft('')

    let accumulated = ''
    await askClaude(data, next, {
      onText: (delta) => {
        accumulated += delta
        setDraft(accumulated)
      },
      onDone: (full) => {
        setMessages((m) => [...m, { role: 'assistant', content: full || accumulated }])
        setDraft('')
        setStreaming(false)
      },
      onError: (msg) => {
        setError(msg)
        setStreaming(false)
        setDraft('')
      },
    })
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] sm:h-[calc(100vh-7rem)] animate-fade-up">
      <div className="mb-4">
        <h2 className="text-2xl">Assistant</h2>
        <p className="text-muted">
          Ask Claude about your finances. Your data is sent only to Anthropic when you ask —
          never stored on a server.
        </p>
      </div>

      {!keyed && (
        <div className="card p-4 mb-4 flex items-center gap-3 border-gold/40 bg-gold/5">
          <IconLock className="text-gold shrink-0" />
          <div className="text-sm flex-1">
            Add your Anthropic API key to start chatting. It's stored only on this device.
          </div>
          <button className="btn-ghost shrink-0" onClick={goToSettings}>
            Open Settings
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="card flex-1 overflow-y-auto p-5 space-y-4"
      >
        {messages.length === 0 && !draft && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Logo className="w-14 h-14 mb-4 rounded-2xl shadow-soft" />
            <p className="text-muted max-w-sm mb-5">
              I can see your accounts, plan, forecast and money dates. Ask me anything —
              for example:
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="pill bg-forest-tint text-forest hover:bg-forest hover:text-paper transition text-left"
                  onClick={() => send(s)}
                  disabled={!keyed}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {draft && <Bubble role="assistant" content={draft} streaming />}
        {error && (
          <div className="rounded-lg bg-clay/10 border border-clay/30 px-4 py-3 text-sm text-clay">
            {error}
          </div>
        )}
      </div>

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          className="input resize-none flex-1 max-h-32"
          rows={1}
          placeholder={keyed ? 'Ask about your finances…' : 'Add an API key in Settings to chat'}
          value={input}
          disabled={!keyed || streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
        />
        <button
          type="submit"
          className="btn-primary h-[42px] px-4"
          disabled={!keyed || streaming || !input.trim()}
        >
          <IconSend width={18} height={18} />
        </button>
      </form>
    </div>
  )
}

function Bubble({
  role,
  content,
  streaming,
}: {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[80%] rounded-2xl rounded-br-md bg-forest text-paper px-4 py-2.5 text-sm whitespace-pre-wrap'
            : 'max-w-[85%] rounded-2xl rounded-bl-md bg-canvas border border-line px-4 py-2.5 text-sm text-ink'
        }
      >
        {isUser ? content : <Markdown text={content} />}
        {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-sage animate-pulse" />}
      </div>
    </div>
  )
}
