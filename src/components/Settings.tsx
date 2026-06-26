import { useRef, useState } from 'react'
import { useData } from '../store'
import { exportData, importData, demoData, emptyData } from '../lib/storage'
import { IconDownload, IconUpload, IconLock } from './icons'

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — fast & balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — quickest & cheapest' },
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'MXN', 'BRL', 'INR']

export function Settings() {
  const { data, setData, update } = useData()
  const fileRef = useRef<HTMLInputElement>(null)
  const [showKey, setShowKey] = useState(false)
  const [msg, setMsg] = useState('')

  function set<K extends keyof typeof data.settings>(key: K, value: (typeof data.settings)[K]) {
    update((d) => {
      d.settings[key] = value
      return d
    })
  }

  async function onImport(file: File) {
    try {
      const next = await importData(file)
      setData(next)
      setMsg('Backup restored.')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not import that file.')
    }
  }

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 2500)
  }

  return (
    <div className="space-y-6 animate-fade-up max-w-2xl">
      <div>
        <h2 className="text-2xl">Settings</h2>
        <p className="text-muted">Assistant, currency and your data</p>
      </div>

      {/* Assistant */}
      <div className="card p-6 space-y-4">
        <h3 className="text-lg">Claude assistant</h3>
        <div>
          <label className="label">Anthropic API key</label>
          <div className="flex gap-2">
            <input
              className="input font-mono"
              type={showKey ? 'text' : 'password'}
              placeholder="sk-ant-…"
              value={data.settings.apiKey}
              onChange={(e) => set('apiKey', e.target.value.trim())}
            />
            <button className="btn-ghost shrink-0" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-xs text-muted mt-1.5 flex items-center gap-1.5">
            <IconLock width={13} height={13} />
            Stored only in this browser. Get a key at console.anthropic.com.
          </p>
        </div>
        <div>
          <label className="label">Model</label>
          <select
            className="input"
            value={data.settings.model}
            onChange={(e) => set('model', e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preferences */}
      <div className="card p-6 space-y-4">
        <h3 className="text-lg">Preferences</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Your name</label>
            <input
              className="input"
              placeholder="Optional"
              value={data.settings.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Currency</label>
            <select
              className="input"
              value={data.settings.currency}
              onChange={(e) => set('currency', e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Data */}
      <div className="card p-6 space-y-4">
        <h3 className="text-lg">Your data</h3>
        <p className="text-sm text-muted">
          Everything lives in this browser. Back it up to a file you can keep on your device or
          drop into your own Google Drive — nothing is ever sent to GitHub or our servers.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => exportData(data)}>
            <IconDownload width={16} height={16} /> Export backup
          </button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <IconUpload width={16} height={16} /> Restore backup
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              setData(demoData())
              flash('Sample data loaded.')
            }}
          >
            Load sample data
          </button>
          <button
            className="btn-subtle text-clay"
            onClick={() => {
              if (confirm('Erase all CasaresSan Finances data on this device? This cannot be undone.')) {
                setData(emptyData())
                flash('All data cleared.')
              }
            }}
          >
            Erase everything
          </button>
        </div>
        {msg && <div className="text-sm text-forest">{msg}</div>}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImport(f)
            e.target.value = ''
          }}
        />
      </div>

      <p className="text-xs text-muted text-center pt-2">
        CasaresSan Finances keeps your financial life private and on-device.
      </p>
    </div>
  )
}
