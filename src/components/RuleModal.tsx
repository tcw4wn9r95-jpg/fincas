import { useState } from 'react'
import { CATEGORIES, suggestKeyword } from '../lib/categorize'
import { IconClose } from './icons'

/** A tiny form to turn "this line means X" into a reusable, remembered rule. */
export function RuleModal({
  description,
  initialCategory,
  matchCount,
  onCancel,
  onSave,
}: {
  description: string
  initialCategory: string
  /** How many rows the current match text would affect (for the live hint). */
  matchCount: (match: string) => number
  onCancel: () => void
  onSave: (match: string, category: string) => void
}) {
  const [match, setMatch] = useState(suggestKeyword(description))
  const [category, setCategory] = useState(
    initialCategory === 'Other' ? 'Transfer' : initialCategory,
  )
  const affected = matchCount(match)

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
      <div className="bg-paper w-full sm:max-w-sm sm:rounded-xl2 rounded-t-xl2 shadow-lift">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-lg">Teach a category</h2>
          <button className="btn-subtle p-2" onClick={onCancel} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted truncate" title={description}>
            From: <span className="text-ink">{description}</span>
          </p>
          <div>
            <label className="label">When a description contains</label>
            <input
              className="input"
              value={match}
              onChange={(e) => setMatch(e.target.value)}
              placeholder="e.g. carte visa"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Categorise as</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted">
            {match.trim()
              ? `Applies to ${affected} row${affected === 1 ? '' : 's'} here, and to matching lines on every future import.`
              : 'Enter some text to match on.'}
          </p>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => onSave(match, category)}
            disabled={!match.trim()}
          >
            Save rule
          </button>
        </div>
      </div>
    </div>
  )
}
