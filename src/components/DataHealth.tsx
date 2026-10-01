import { useMemo, useState } from 'react'
import { useData } from '../store'
import { runHealthChecks, type HealthAction, type HealthIssue, type Severity } from '../lib/health'
import { applyRefile } from '../lib/refile'
import { duplicatePairs, resolveDuplicate } from '../lib/month'
import { classNames, uid } from '../lib/format'

type OpenTab = Extract<HealthAction, { kind: 'open' }>['tab']

const TONE: Record<Severity, { dot: string; border: string; label: string }> = {
  error: { dot: 'bg-clay', border: 'border-clay/40', label: 'Wrong until fixed' },
  warn: { dot: 'bg-gold', border: 'border-gold/40', label: 'Worth a look' },
  info: { dot: 'bg-sage', border: 'border-line', label: 'For the record' },
}

/**
 * The checks an auditor would run before trusting a figure, run on every load
 * and shown where the figures are. Quiet when everything passes — one line —
 * and open by default when something is wrong, because a total built on a
 * duplicate or a misfiled card is wrong everywhere it appears.
 */
export function DataHealth({ goTo }: { goTo: (tab: OpenTab, month?: string) => void }) {
  const { data, update } = useData()
  const issues = useMemo(() => runHealthChecks(data), [data])
  const problems = issues.filter((i) => i.severity !== 'info')
  const [open, setOpen] = useState(problems.some((i) => i.severity === 'error'))

  if (!issues.length) {
    return (
      <p className="text-sm text-muted flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-sage" />
        Data health: every check passes
      </p>
    )
  }

  function act(a: HealthAction) {
    if (a.kind === 'open') return goTo(a.tab, a.month)
    if (a.kind === 'resolve-duplicates') {
      const n = a.months.reduce((s, m) => s + duplicatePairs(data, m).length, 0)
      if (!confirm(`Remove the extra copy of ${n} lines? Each keeps the copy with your pot splits and trip tags on it.`)) return
      update((d) => {
        for (const m of a.months) for (const p of duplicatePairs(d, m)) resolveDuplicate(d, p, 'imported')
        return d
      })
      return
    }
    if (a.kind === 'mark-one-off') {
      const ids = new Set(a.txIds)
      update((d) => {
        for (const t of d.transactions) if (ids.has(t.id)) t.oneOff = true
        return d
      })
      return
    }
    const lines = a.proposal.summary.map((s) => `• ${s.count} to ${s.toName}, e.g. ${s.examples[0]}`).join('\n')
    if (!confirm(`Move these lines to the account their statement says they belong to?\n\n${lines}`)) return
    update((d) => applyRefile(d, a.proposal, uid))
  }

  const worst = issues[0].severity
  return (
    <div className={classNames('card p-5', TONE[worst].border)}>
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2.5">
          <span className={classNames('inline-block w-2.5 h-2.5 rounded-full', TONE[worst].dot)} />
          <h3 className="text-lg">Data health</h3>
          <span className="text-sm text-muted">
            {problems.length
              ? `${problems.length} ${problems.length === 1 ? 'issue' : 'issues'} to look at`
              : 'every check passes'}
          </span>
        </div>
        <span className="text-sm text-muted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="mt-4 space-y-3">
          {issues.map((i) => (
            <Issue key={i.id} issue={i} onAct={act} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Issue({ issue, onAct }: { issue: HealthIssue; onAct: (a: HealthAction) => void }) {
  const tone = TONE[issue.severity]
  return (
    <li className={classNames('rounded-lg border bg-canvas px-4 py-3', tone.border)}>
      <div className="flex items-start gap-2.5">
        <span className={classNames('mt-1.5 inline-block w-2 h-2 rounded-full shrink-0', tone.dot)} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{issue.title}</p>
          <p className="text-sm text-muted mt-0.5 break-words">{issue.detail}</p>
          {issue.actions && issue.actions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {issue.actions.map((a, n) => (
                <button
                  key={n}
                  className={classNames('text-xs', n === 0 ? 'btn-primary' : 'btn-subtle')}
                  onClick={() => onAct(a)}
                >
                  {a.kind === 'open'
                    ? a.label
                    : a.kind === 'refile'
                      ? 'Move them'
                      : a.kind === 'resolve-duplicates'
                        ? 'Fix all'
                        : 'Mark as one-off'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
