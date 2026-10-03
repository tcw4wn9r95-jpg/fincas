import { useMemo, useRef, useState } from 'react'
import { useData } from '../store'
import { parseFile, type ParsedResult, type StatementSummary } from '../lib/parse'
import { applyStatementBalance, isCardAccount, trackedAccountName } from '../lib/forecast'
import { CATEGORIES, matchRule, withRule } from '../lib/categorize'
import { formatMoney, formatMonthLabel, classNames, uid, txMatchKey, todayISO } from '../lib/format'
import { foreignLineMatches } from '../lib/fx'
import { REVOLUT_NAME, dupeKey, foldSaved, revolutAccount, saveImport } from '../lib/importer'
import { recall, reconciledHistory } from '../lib/learn'
import type { Transaction } from '../lib/types'
import { IconClose, IconUpload, IconTrash, IconTag } from './icons'
import { RuleModal } from './RuleModal'
import { CategorizeOverlay } from './CategorizeOverlay'
import { Portal } from './Portal'

// Exact duplicates (date+amount+description) are skipped on import. These helpers
// catch the softer case: same date and amount, description merely similar — e.g.
// a pending charge re-posted as settled with a tweaked label. We flag, never drop.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function similarDesc(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 4 && nb.includes(na)) return true
  if (nb.length >= 4 && na.includes(nb)) return true
  const tb = new Set(nb.split(' ').filter((w) => w.length >= 4))
  for (const w of na.split(' ')) if (w.length >= 4 && tb.has(w)) return true
  return false
}

interface ImportModalProps {
  onClose: () => void
  title?: string
  subtitle?: string
  /** When provided, receives the reviewed rows instead of the default
   *  save-into-money-date behaviour (used by the weekly check-in). */
  onImport?: (rows: Transaction[]) => void
  /** Already-saved transactions for this stream, used to skip re-imports so you
   *  can add statements one at a time without double-counting overlaps. */
  existing?: Transaction[]
  /** Money-date mode: saving replaces every covered month, so a re-uploaded
   *  statement overwrites rather than appends. Existing rows for those months
   *  are pulled into the review so nothing is lost. Also makes the review a
   *  verify-only step (no categorising) — that happens once, in reconcile. */
  replaceMonths?: boolean
  /** Called after a successful save (money date opens reconcile from here). */
  onSaved?: () => void
}


export function ImportModal({
  onClose,
  title,
  subtitle,
  onImport,
  existing,
  replaceMonths,
  onSaved,
}: ImportModalProps) {
  const { data, update } = useData()
  const { currency, locale } = data.settings
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Transaction[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  // Only a current-account statement states a balance we're willing to trust —
  // see `readStatementSummary`. Held so Save can move the account with it.
  const [statement, setStatement] = useState<StatementSummary | null>(null)
  // What kind of file this was, and whether its own arithmetic agreed — kept
  // with the import's record, and shown before Save.
  const [fileSource, setFileSource] = useState<ParsedResult['source']>()
  const [tieOut, setTieOut] = useState<ParsedResult['tieOut']>()
  // Which account these lines belong to. It decides what a card statement does
  // to the debt, so it is asked plainly rather than inferred and hoped for —
  // the file only preselects.
  const [accountId, setAccountId] = useState('')
  // Named so the picker can say what just happened — creating an account
  // silently, the first time, would read as the app guessing at random.
  const [autoCreatedCard, setAutoCreatedCard] = useState<string | null>(null)
  const trackedAccount = data.accounts.find((a) => a.tracked && !isCardAccount(a))
  const fx = (n: number) => formatMoney(n, currency, locale)
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [teaching, setTeaching] = useState<Transaction | null>(null)
  const [categorizing, setCategorizing] = useState(false)

  const savedStream = existing ?? data.transactions

  // Save (or update) a taught rule and apply it to every matching row on screen,
  // so the lesson takes effect now and on every future import.
  function saveRule(match: string, category: string) {
    const m = match.trim()
    if (m) {
      update((d) => {
        d.categoryRules = withRule(d.categoryRules, uid(), m, category)
        return d
      })
      const needle = m.toLowerCase()
      setRows((prev) =>
        prev.map((r) => (r.description.toLowerCase().includes(needle) ? { ...r, category } : r)),
      )
    }
    setTeaching(null)
  }

  // Changing a category re-files every staged row that's the same recurring item
  // (same description AND amount), so identical lines follow while a same-worded
  // line with a different amount stays independent. For a broad keyword rule,
  // use the tag (Teach) button on the row.
  function changeCategory(t: Transaction, category: string) {
    const key = txMatchKey(t.description, t.amount)
    setRows((prev) =>
      prev.map((r) => (txMatchKey(r.description, r.amount) === key ? { ...r, category } : r)),
    )
  }

  // Parse one or several files and merge them into the review. Rows matching what
  // you've already saved or staged are skipped, so re-adding an overlapping
  // statement won't double-count. Rows are only checked against that pre-existing
  // set — never against each other in this same batch — so two genuinely distinct
  // charges with the same date/amount/label inside one statement are both kept
  // (the soft "possible duplicate" flag surfaces them for a look instead).
  async function onPick(picked: File[]) {
    if (!picked.length) return
    setBusy(true)
    // In replace mode, saving overwrites the month, so we don't skip against
    // saved data — only against what's already staged (avoids re-picking a file
    // twice). In append mode we also skip anything already saved.
    const seen = new Set<string>(
      replaceMonths ? rows.map(dupeKey) : [...savedStream.map(dupeKey), ...rows.map(dupeKey)],
    )
    // Memory of exact descriptions you've already reconciled (any month) → their
    // category, so an identical line arrives pre-categorised and pre-reconciled.
    // Every import, not only the money date's: a Revolut export dropped into
    // "This month" deserves the same memory as a statement.
    const reconciledMemory = new Map<string, string>()
    for (const t of data.transactions) {
      if (t.reconciled) reconciledMemory.set(txMatchKey(t.description, t.amount), t.category)
    }
    // How each merchant has been reconciled, references and dates aside — so
    // "DEBIT TPV AUCHAN 03.07" learns from every Auchan line before it.
    const history = reconciledHistory(data)
    const added: Transaction[] = []
    const warns: string[] = []
    const names: string[] = []
    let foundStatement: StatementSummary | null = null
    let foundSource: 'current' | 'card' | 'revolut' | undefined
    // First one wins, matching foundSource/foundStatement: a batch is staged
    // against one account, so a card statement further down a mixed drop
    // can't steal the pick from the first.
    let foundCardholder: string | undefined
    let skipped = 0
    const checks: NonNullable<ParsedResult['tieOut']>[] = []
    for (const file of picked) {
      names.push(file.name)
      try {
        const res = await parseFile(file)
        for (const w of res.warnings) warns.push(`${file.name}: ${w}`)
        // Last statement wins when several are dropped at once: its closing
        // balance is the most recent word on the account.
        if (res.statement && (!foundStatement || res.statement.asOf >= foundStatement.asOf)) {
          foundStatement = res.statement
        }
        if (res.source && !foundSource) foundSource = res.source
        if (res.tieOut) checks.push(res.tieOut)
        if (res.cardholderName && !foundCardholder) foundCardholder = res.cardholderName
        for (const t of res.transactions) {
          // Check against the pre-existing set only — not rows added earlier in
          // THIS batch — so two genuinely identical charges in one statement are
          // both kept, while re-adding an already-staged statement is skipped.
          if (seen.has(dupeKey(t))) {
            skipped++
            continue
          }
          // An exact description you've reconciled before wins outright (and
          // comes in already reconciled); otherwise your taught keyword rules
          // beat the automatic guess.
          // An identical line reconciled before wins outright and comes in
          // reconciled; then a rule the user taught; then how this merchant has
          // been reconciled; and only then the generic guess.
          const remembered = reconciledMemory.get(txMatchKey(t.description, t.amount))
          const learned = matchRule(t.description, data.categoryRules) ?? recall(history, t)?.category
          if (remembered) added.push({ ...t, category: remembered, reconciled: true })
          else added.push(learned ? { ...t, category: learned } : t)
        }
      } catch (err) {
        warns.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be read'}`)
      }
    }
    if (foundSource) setFileSource(foundSource)
    if (checks.length) {
      // Several files at once: the batch agrees only if every file does.
      const last = checks[checks.length - 1]
      setTieOut({
        opening: checks[0].opening,
        closing: last.closing,
        agrees: checks.every((c) => c.agrees === true) ? true : checks.some((c) => c.agrees === false) ? false : undefined,
        difference: Math.round(checks.reduce((s, c) => s + (c.difference ?? 0), 0) * 100) / 100,
      })
    }
    if (foundStatement) {
      setStatement(foundStatement)
    }
    // Preselect the account the document looks like, but only while the user
    // hasn't chosen one — their pick always wins over the guess. Tracked
    // locally rather than read back off the `accountId` state: the `setRows`
    // update below runs in this same call, before React has re-rendered, so
    // the state would still read whatever it was when onPick started.
    let resolvedAccountId = accountId
    if (foundSource === 'card' && foundCardholder && !accountId) {
      // A named cardholder is a stronger signal than "there's a card" — it's
      // what lets two people's cards stay apart. Match on the durable key
      // first, falling back to today's display name for a card that predates
      // this or was added by hand; either way the key gets (re)written so a
      // later rename can't break the match again.
      const key = foundCardholder.trim().toLowerCase()
      let match = data.accounts.find((a) => isCardAccount(a) && a.cardholderKey === key)
      if (!match) match = data.accounts.find((a) => isCardAccount(a) && a.name.trim().toLowerCase() === key)
      if (match) {
        const id = match.id
        if (match.cardholderKey !== key) {
          update((d) => {
            const a = d.accounts.find((x) => x.id === id)
            if (a) a.cardholderKey = key
            return d
          })
        }
        setAccountId(id)
        resolvedAccountId = id
      } else {
        const id = uid()
        update((d) => {
          d.accounts.push({
            id,
            name: foundCardholder!,
            balance: 0,
            asOf: todayISO(),
            kind: 'card',
            cardholderKey: key,
          })
          return d
        })
        setAccountId(id)
        resolvedAccountId = id
        setAutoCreatedCard(foundCardholder)
      }
    } else if (foundSource === 'revolut' && !accountId && !revolutAccount(data)) {
      // The first Revolut export creates the account it belongs to, the same
      // way a card statement creates its card — left to the picker, these
      // lines landed on whatever account it held.
      const id = uid()
      update((d) => {
        d.accounts.push({ id, name: REVOLUT_NAME, balance: 0, asOf: '' })
        return d
      })
      setAccountId(id)
      resolvedAccountId = id
      setAutoCreatedCard(REVOLUT_NAME)
    } else if (foundSource && !accountId) {
      const guess =
        foundSource === 'card'
          ? data.accounts.find(isCardAccount)
          : foundSource === 'current'
            ? trackedAccount ?? data.accounts.find((a) => !isCardAccount(a))
            : data.accounts.find((a) => !isCardAccount(a) && /revolut/i.test(a.name))
      if (guess) {
        setAccountId(guess.id)
        resolvedAccountId = guess.id
      }
    }
    if (skipped) warns.unshift(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} already staged.`)
    if (!added.length && !warns.length) warns.push('No new transactions found in that file.')
    // Replace mode: fold in this same account's own saved rows for the months
    // this import touches, so re-importing a fuller statement over a partial
    // earlier one doesn't lose rows the new file doesn't repeat. Scoped to this
    // account on purpose — see `foldSaved`, which the picker re-runs too.
    setRows((prev) =>
      replaceMonths ? foldSaved([...prev, ...added], savedStream, resolvedAccountId) : [...prev, ...added],
    )
    setFiles((prev) => [...prev, ...names])
    setWarnings(warns)
    setBusy(false)
  }

  function patch(id: string, fields: Partial<Transaction>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)))
  }
  function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }
  function flipAll() {
    setRows((prev) => prev.map((r) => ({ ...r, amount: -r.amount })))
  }

  // Rows that look like a possible re-post of something already saved, or of
  // another staged row: same date and amount, similar (not identical) label.
  const suspectIds = useMemo(() => {
    const flagged = new Set<string>()
    const savedByDA = new Map<string, string[]>()
    for (const t of savedStream) {
      const k = `${t.date}|${t.amount}`
      const list = savedByDA.get(k)
      if (list) list.push(t.description)
      else savedByDA.set(k, [t.description])
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const against = savedByDA.get(`${r.date}|${r.amount}`) ?? []
      let hit = against.some((d) => d !== r.description && similarDesc(d, r.description))
      if (!hit) {
        for (let j = 0; j < rows.length; j++) {
          if (j === i) continue
          const o = rows[j]
          if (
            o.date === r.date &&
            o.amount === r.amount &&
            o.description !== r.description &&
            similarDesc(o.description, r.description)
          ) {
            hit = true
            break
          }
        }
      }
      if (hit) flagged.add(r.id)
    }
    return flagged
  }, [rows, savedStream])

  function removeSuspects() {
    setRows((prev) => prev.filter((r) => !suspectIds.has(r.id)))
  }

  // Stand-ins this file is now bringing in for real: spends typed before the
  // statement existed, and bills the month assumed were paid. Either way the
  // imported line is the better record — it carries the real merchant, date and
  // amount — so the default is to let it replace the placeholder rather than
  // have both count.
  const manualDupes = useMemo(() => {
    const claimed = new Set<string>()
    const pairs: Array<{ rowId: string; manual: Transaction }> = []
    // A row the user has already said is not a duplicate stays out of it.
    const logged = savedStream.filter((t) => t.source === 'manual' && !t.notDuplicate)
    if (!logged.length) return pairs

    // Only hand-logged spends are candidates. A plan line the month counted as
    // settled is a note against a budget pocket, not a row competing with the
    // statement: the arriving charge fills the pocket and the assumption stops
    // counting by itself, so there is nothing here to supersede.
    for (const r of rows) {
      const hit =
        logged.find(
          (m) => !claimed.has(m.id) && m.date === r.date && Math.abs(m.amount - r.amount) < 0.005,
        ) ??
        // A spend paid abroad is matched on either figure: the statement may
        // post the original currency, or the bank's own conversion of it at a
        // rate that is never the reference rate we recorded.
        logged.find((m) => !claimed.has(m.id) && m.foreign && foreignLineMatches(m, r))
      if (hit) {
        claimed.add(hit.id)
        pairs.push({ rowId: r.id, manual: hit })
      }
    }
    return pairs
  }, [rows, savedStream])
  const [keepManual, setKeepManual] = useState(false)
  const supersededIds = keepManual ? [] : manualDupes.map((p) => p.manual.id)

  /**
   * Changing the account re-runs the fold-in, so the review always shows what
   * Save will write. Before, the fold-in ran once for the account preselected
   * when the file was picked; changing the picker afterwards saved the
   * original lines *and* the folded copies — every line of July, twice.
   */
  function pickAccount(id: string) {
    setAccountId(id)
    if (replaceMonths) setRows((prev) => foldSaved(prev, savedStream, id))
  }

  function save() {
    if (!rows.length) return
    if (onImport) {
      onImport(accountId ? rows.map((r) => (r.accountId ? r : { ...r, accountId })) : rows)
      onClose()
      return
    }
    update((d) => {
      saveImport(d, {
        rows,
        accountId,
        replaceMonths: !!replaceMonths,
        // Hand-logged lines this file is bringing in for real — dropped as it
        // saves, so the same spend never sits in the month twice.
        supersededIds,
        files,
        source: fileSource,
        periodEnd: statement?.asOf,
        tieOut,
        batchId: uid(),
        at: new Date().toISOString(),
      })
      if (statement && !cardChosen) applyStatementBalance(d, statement)
      return d
    })
    onClose()
    onSaved?.()
  }

  const cardChosen = data.accounts.some((a) => a.id === accountId && isCardAccount(a))
  const inCount = rows.filter((r) => r.amount >= 0).length
  const outCount = rows.length - inCount
  const otherCount = rows.filter((r) => r.category === 'Other').length
  // Months this import will overwrite that already hold saved data.
  const replacingMonths = replaceMonths
    ? Array.from(new Set(rows.map((r) => r.month)))
        .filter((m) => savedStream.some((t) => t.month === m))
        .sort()
    : []

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
      <div className="bg-paper w-full sm:max-w-3xl sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div>
            <h2 className="text-xl">{title ?? 'Import a statement'}</h2>
            <p className="text-sm text-muted">
              {subtitle ??
                (replaceMonths
                  ? 'Check the amounts look right — you’ll sort categories next, in reconcile'
                  : 'CSV or PDF — parsed privately on your device')}
            </p>
          </div>
          <button className="btn-subtle p-2" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {rows.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-line rounded-xl2 py-12 flex flex-col items-center gap-3 text-muted hover:border-forest hover:text-forest hover:bg-forest-tint/40 transition"
            >
              <IconUpload width={32} height={32} />
              <div className="font-medium text-ink">
                {busy ? 'Reading…' : 'Choose CSV or PDF statements'}
              </div>
              <div className="text-sm">
                Pick one or several — you can add more before saving, or come back anytime
              </div>
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="text-sm text-muted">
                  <span className="text-ink font-medium">{rows.length}</span> rows from{' '}
                  <span className="text-ink">
                    {files.length} {files.length === 1 ? 'file' : 'files'}
                  </span>{' '}
                  · {inCount} in · {outCount} out
                </div>
                <div className="flex items-center gap-2">
                  {otherCount > 0 && !replaceMonths && (
                    <button
                      className="btn-primary text-xs inline-flex items-center gap-1 py-1.5"
                      onClick={() => setCategorizing(true)}
                    >
                      <IconTag width={13} height={13} /> Categorize {otherCount}
                    </button>
                  )}
                  <button
                    className="btn-subtle text-xs inline-flex items-center gap-1"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                  >
                    <IconUpload width={13} height={13} /> {busy ? 'Reading…' : 'Add more files'}
                  </button>
                  <button className="btn-subtle text-xs" onClick={flipAll}>
                    Flip all signs
                  </button>
                </div>
              </div>

              {replacingMonths.length > 0 && (
                <div className="mb-3 rounded-lg bg-forest-tint/60 border border-line px-4 py-2.5 text-sm text-ink/80">
                  Saving updates{' '}
                  {replacingMonths
                    .map((m) => formatMonthLabel(m + '-01', locale))
                    .join(', ')}{' '}
                  — existing transactions for {replacingMonths.length === 1 ? 'that month' : 'those months'}{' '}
                  are shown here and will be replaced by this reviewed set.
                </div>
              )}


              {manualDupes.length > 0 && (
                <div className="mb-3 rounded-lg bg-gold/10 border border-gold/30 px-4 py-2.5 text-sm">
                  <div className="text-ink/80">
                    {manualDupes.length} of these {manualDupes.length === 1 ? 'is' : 'are'} already here as{' '}
                    {manualDupes.length === 1 ? 'a spend' : 'spends'} you logged by hand.{' '}
                    {keepManual
                      ? 'Both will be kept, so this month will count them twice.'
                      : 'The line you logged will be dropped as this saves, so nothing counts twice.'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button className="btn-subtle text-xs" onClick={() => setKeepManual((k) => !k)}>
                      {keepManual ? 'Drop the lines I logged' : 'Keep both anyway'}
                    </button>
                    <span className="text-xs text-muted">
                      {manualDupes
                        .slice(0, 3)
                        .map((p) => `${p.manual.date.slice(5)} ${fx(Math.abs(p.manual.amount))} \u201C${p.manual.description}\u201D`)
                        .join(' \u00b7 ')}
                      {manualDupes.length > 3 ? ` \u00b7 +${manualDupes.length - 3} more` : ''}
                    </span>
                  </div>
                </div>
              )}

              {suspectIds.size > 0 && (
                <div className="mb-3 rounded-lg bg-gold/10 border border-gold/30 px-4 py-2.5 text-sm flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink/80">
                    {suspectIds.size} row{suspectIds.size === 1 ? '' : 's'} look like possible
                    duplicates — same date and amount as something already imported, with a
                    similar name. Check the highlighted rows.
                  </span>
                  <button className="btn-subtle text-xs shrink-0" onClick={removeSuspects}>
                    Remove {suspectIds.size === 1 ? 'it' : 'them'}
                  </button>
                </div>
              )}
              <div className="border border-line rounded-xl overflow-hidden">
                <div>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-canvas z-10">
                      <tr className="text-left text-muted border-b border-line">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        {!replaceMonths && <th className="px-3 py-2 font-medium">Category</th>}
                        <th className="px-3 py-2 font-medium text-right">Amount</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const suspect = suspectIds.has(r.id)
                        return (
                        <tr
                          key={r.id}
                          className={classNames('border-b border-line/60', suspect && 'bg-gold/10')}
                        >
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted">{r.date}</td>
                          <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.description}>
                            {r.description}
                            {suspect && (
                              <span className="ml-1.5 pill bg-gold/20 text-ink/70 align-middle">
                                possible duplicate
                              </span>
                            )}
                          </td>
                          {!replaceMonths && (
                            <td className="px-3 py-1.5">
                              <select
                                className="bg-transparent text-sm outline-none cursor-pointer hover:text-forest"
                                value={r.category}
                                onChange={(e) => changeCategory(r, e.target.value)}
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td
                            className={classNames(
                              'px-3 py-1.5 text-right font-medium tabular-nums',
                              r.amount >= 0 ? 'text-forest' : 'text-clay',
                            )}
                          >
                            <button
                              onClick={() => patch(r.id, { amount: -r.amount })}
                              title="Click to flip sign"
                              className="hover:underline"
                            >
                              {formatMoney(r.amount, currency, locale, { signed: true })}
                            </button>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {!replaceMonths && (
                                <button
                                  className="text-muted hover:text-forest"
                                  onClick={() => setTeaching(r)}
                                  title="Teach a rule from this row"
                                  aria-label="Teach a rule"
                                >
                                  <IconTag width={15} height={15} />
                                </button>
                              )}
                              <button
                                className="text-muted hover:text-clay"
                                onClick={() => remove(r.id)}
                                aria-label="Remove"
                              >
                                <IconTrash width={16} height={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {rows.length > 0 && data.accounts.length > 0 && (
            <div className="mt-4 rounded-lg border border-line bg-canvas px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted mr-1">These lines are from</span>
                {data.accounts.map((a) => (
                  <button
                    key={a.id}
                    className={classNames(
                      'pill border transition',
                      accountId === a.id
                        ? 'bg-forest text-paper border-forest'
                        : 'border-line text-muted hover:text-forest',
                    )}
                    onClick={() => pickAccount(accountId === a.id ? '' : a.id)}
                  >
                    {a.name}
                    {isCardAccount(a) && ' (card)'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-2">
                {autoCreatedCard === REVOLUT_NAME && accountId
                  ? 'This is a Revolut export, so its lines go to a Revolut account — created now, since there wasn’t one.'
                  : autoCreatedCard && accountId
                  ? `Created “${autoCreatedCard}” as a new card, reading the name straight off the statement — a later statement for the same person will find it again on its own.`
                  : cardChosen
                    ? 'Charges on a card are spending the day they happen; paying the card bill later is not spending again.'
                    : 'Naming the account keeps each statement’s lines separate, so a card and a current account covering the same month never overwrite each other.'}
              </p>
            </div>
          )}

          {/* The file's own arithmetic, said before anything is saved: the one
              check that proves every line was read once. */}
          {tieOut && tieOut.agrees !== undefined && (
            <div
              className={classNames(
                'mt-4 rounded-lg border px-4 py-3 text-sm',
                tieOut.agrees ? 'border-forest/30 bg-forest-tint/30' : 'border-clay/40 bg-clay/5',
              )}
            >
              <span className="font-medium">
                {tieOut.agrees ? '✓ Matches the statement' : `✗ Off from the statement by ${fx(tieOut.difference ?? 0)}`}
              </span>
              <span className="block text-xs text-muted mt-0.5">
                {tieOut.agrees
                  ? `${tieOut.opening != null ? `Opening ${fx(tieOut.opening)} plus these lines lands` : 'These lines land'} exactly on its closing ${fx(tieOut.closing)}, so every line was read once.`
                  : 'Its balances don’t follow from these lines — one was missed or read twice. Compare against the statement before saving; the import will be marked as not matching.'}
              </span>
            </div>
          )}

          {/* Not a choice any more: the current account's balance is the one
              the app keeps, and its own statement is what keeps it. */}
          {statement && !cardChosen && (
            <p className="mt-4 text-sm text-muted">
              Saving sets {trackedAccount?.name ?? trackedAccountName} to{' '}
              <span className="text-ink tabular-nums">{fx(statement.closingBalance)}</span>, the closing balance
              this statement states for {statement.asOf}.
            </p>
          )}

          {warnings.length > 0 && (
            <div className="mt-4 rounded-lg bg-gold/10 border border-gold/30 px-4 py-3 text-sm text-ink/80">
              {warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={!rows.length}>
            Save {rows.length || ''} transactions
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            if (picked.length) onPick(picked)
            e.target.value = ''
          }}
        />
      </div>

      {teaching && (
        <RuleModal
          description={teaching.description}
          initialCategory={teaching.category}
          matchCount={(m) =>
            rows.filter((r) => m.trim() && r.description.toLowerCase().includes(m.trim().toLowerCase())).length
          }
          onCancel={() => setTeaching(null)}
          onSave={saveRule}
        />
      )}
      {categorizing && (
        <CategorizeOverlay
          rows={rows}
          currency={currency}
          locale={locale}
          onSet={(id, category) => patch(id, { category })}
          onLearn={(t, category) => {
            patch(t.id, { category })
            saveRule(t.description.trim(), category)
          }}
          onClose={() => setCategorizing(false)}
        />
      )}
    </div>
    </Portal>
  )
}
