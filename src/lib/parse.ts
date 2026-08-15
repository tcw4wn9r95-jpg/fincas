import Papa from 'papaparse'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Transaction } from './types'
import { categorize } from './categorize'
import { uid } from './format'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

export interface ParsedResult {
  transactions: Transaction[]
  warnings: string[]
  /** Only set for a current-account statement that states its own balances. */
  statement?: StatementSummary
  /**
   * What the document looks like, so an import can preselect the account it
   * belongs to. A guess for the picker, never a decision about the figures.
   */
  source?: 'current' | 'card' | 'revolut'
  /**
   * The cardholder's name, read off a credit-card statement's own header —
   * "Titular: MARIA GARCIA", "Cardholder: John Smith". Only ever populated
   * for something that already looks like a card statement, and only ever
   * used to name and re-find the card it belongs to — never to decide
   * anything about the figures.
   */
  cardholderName?: string
}

/**
 * The header and footer figures a current-account statement prints around its
 * rows. Two jobs: the closing balance is the bank's own word for what the
 * account holds, and opening + rows = closing is a check that every row was
 * actually read — statement parsing is best-effort, and this turns "probably
 * fine" into something provable.
 */
export interface StatementSummary {
  closingBalance: number
  openingBalance?: number
  /** End of the statement period. */
  asOf: string
  /** Sum of the parsed rows. */
  rowsTotal: number
  /** openingBalance + rowsTotal lands on closingBalance (within a cent). */
  complete?: boolean
}

function cleanAmount(raw: string): number | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  let negative = false
  // Parentheses denote negatives in many statements: (1,234.56)
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.includes('-')) negative = true
  // Strip currency symbols, spaces, stray signs — keep digits and separators.
  s = s.replace(/[^0-9.,]/g, '')
  // Decide which separator is the decimal point by whichever appears last —
  // handles both "1,234.56" (US/UK) and "1.234,56" (European) statements.
  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  }
  const n = parseFloat(s)
  if (Number.isNaN(n)) return null
  return negative ? -Math.abs(n) : n
}

/**
 * Decide whether numeric dates in a batch are day-first (DD/MM, most of the
 * world) or month-first (MM/DD, US) by looking at the unambiguous ones — a part
 * over 12 can only be the day. Applied uniformly so a whole statement is read in
 * one convention, instead of guessing per row.
 */
function inferDayFirst(samples: Array<string | undefined>): boolean {
  let dayFirst = 0
  let monthFirst = 0
  for (const s of samples) {
    const m = String(s ?? '').match(/(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}/)
    if (!m) continue
    const a = Number(m[1])
    const b = Number(m[2])
    if (a > 12 && b <= 12) dayFirst++
    else if (b > 12 && a <= 12) monthFirst++
  }
  if (dayFirst && !monthFirst) return true
  if (monthFirst && !dayFirst) return false
  // All ambiguous (or conflicting): default day-first — the app's users are in
  // Europe, and a US statement over a month almost always exposes a day > 12.
  return dayFirst >= monthFirst
}

function normalizeDate(raw: string, dayFirst = true): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  // ISO already.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // DD/MM/YYYY or MM/DD/YYYY or with dashes/dots.
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/)
  if (m) {
    let [, a, b, y] = m
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y
    // A part over 12 is unambiguously the day; otherwise fall back to the
    // convention inferred for this batch of dates.
    let month: string, day: string
    if (Number(a) > 12) {
      day = a
      month = b
    } else if (Number(b) > 12) {
      day = b
      month = a
    } else if (dayFirst) {
      day = a
      month = b
    } else {
      month = a
      day = b
    }
    return `${y}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  // "12 Jun 2025" style.
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return null
}

const DATE_KEYS = /(date|posted|transaction date|fecha)/i
const DESC_KEYS = /(description|memo|details|narrative|payee|name|concepto|reference)/i
const AMOUNT_KEYS = /^(amount|importe|value|monto)$/i
const DEBIT_KEYS = /(debit|withdraw|paid out|cargo|expense)/i
const CREDIT_KEYS = /(credit|deposit|paid in|received|abono|income)/i

function pickField(fields: string[], re: RegExp): string | undefined {
  return fields.find((f) => re.test(f.trim()))
}

export function parseCSV(text: string): ParsedResult {
  const warnings: string[] = []
  const out: Transaction[] = []
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })
  const fields = result.meta.fields ?? []
  if (!fields.length) {
    return { transactions: [], warnings: ['Could not read column headers from the CSV.'] }
  }

  const dateF = pickField(fields, DATE_KEYS) ?? fields[0]
  const descF = pickField(fields, DESC_KEYS)
  const amountF = pickField(fields, AMOUNT_KEYS) ?? pickField(fields, /amount/i)
  const debitF = pickField(fields, DEBIT_KEYS)
  const creditF = pickField(fields, CREDIT_KEYS)

  if (!amountF && !debitF && !creditF) {
    warnings.push('No amount/debit/credit column found — amounts may be wrong.')
  }

  const dayFirst = inferDayFirst(result.data.map((row) => row[dateF]))

  for (const row of result.data) {
    const date = normalizeDate(row[dateF], dayFirst)
    if (!date) continue
    const description = (descF ? row[descF] : '') || 'Transaction'

    let amount: number | null = null
    if (amountF && row[amountF]) {
      amount = cleanAmount(row[amountF])
    }
    if (amount == null && (debitF || creditF)) {
      const debit = debitF ? cleanAmount(row[debitF]) : null
      const credit = creditF ? cleanAmount(row[creditF]) : null
      if (debit) amount = -Math.abs(debit)
      else if (credit) amount = Math.abs(credit)
    }
    if (amount == null) continue

    out.push({
      id: uid(),
      date,
      description: description.trim(),
      amount,
      category: categorize(description, amount),
      source: 'csv',
      month: date.slice(0, 7),
    })
  }

  if (!out.length) warnings.push('No rows could be parsed. Check the date and amount columns.')
  return { transactions: out, warnings }
}

export async function parseCSVFile(file: File): Promise<ParsedResult> {
  const text = await file.text()
  const parsed = parseCSV(text)
  return { ...parsed, source: sourceHint(text.slice(0, 4000), file.name) }
}

// ── PDF ──────────────────────────────────────────────────────────
// Bank statement PDFs vary wildly, so we extract the text layer and
// scan for lines that contain a date and a trailing amount. It's a
// best-effort pass; the import preview lets the user fix anything.

const LINE_DATE = /(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/
// A trailing amount, with the sign either leading ("-12,34") or trailing
// ("12,34 -" / "…+" / CR/DR) as many European statements print it. The two
// decimal places are required so bare years/reference numbers aren't mistaken
// for amounts.
const LINE_AMOUNT = /[-+(]?\s?[$€£]?\s?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\)?\s*(?:[-+]|CR|DR)?\s*$/i

// A statement's own summary figures. The current-account marker is required
// before any of it is trusted: a credit-card statement says "New Balance" too,
// and that number is a debt, not money in an account.
const STMT_CURRENT = /current account|compte courant|girokonto|cuenta corriente|checking account/i
/**
 * What kind of statement this looks like — used only to preselect which account
 * an import belongs to, never to decide what a figure means.
 */
const STMT_CARD = /credit card|tarjeta de cr[eé]dito|carte de cr[eé]dit|kreditkarte|\bvisa\b|mastercard|amex|american express/i
const STMT_REVOLUT = /\brevolut\b/i

/**
 * The label a card statement prints above the cardholder's own name, across
 * the wordings this app already reads in (English, Spanish, French, German).
 * Matched loosely — `readCardholderName` decides whether what follows
 * actually looks like a name.
 */
const CARDHOLDER_LABEL =
  /\b(?:card\s*holder(?:'?s)?(?:\s*name)?|name\s+on\s+card|account\s*holder|titular(?:\s+de\s+la\s+tarjeta)?|nombre\s+del\s+titular|titulaire(?:\s+de\s+la\s+carte)?|karteninhaber(?:in)?)\b\s*[:\-]?\s*(.*)$/i
// Two to four capitalised words — a plausible full name, whether the
// statement prints it in Title Case or shouting ALL CAPS. Rejects anything
// with digits (a card or account number sitting on the same line) or a
// single word (a stray label the same regex half-matched).
const NAME_SHAPE = /^[A-ZÀ-ÖØ-Þ][\p{L}'.-]*(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}'.-]*){1,3}$/u
// The line after a name in a plain postal address block — not a label at all,
// just where a bank addresses the letter. Either a house number opening a
// street line ("22 Rue de Gasperich") or a postcode opening a city line
// ("L-5826 Hesperange", "28016 Madrid") — anchored to the start of the line so
// a date or reference number elsewhere in it can't match.
const ADDRESS_LINE = /^(?:\d|[A-Z]{0,3}-?\d{3,6}\s+[A-ZÀ-ÖØ-Þ])/
const STMT_CLOSING = /(new balance|closing balance|nouveau solde|neuer saldo|saldo final)\s*[:.]?\s*([\d.,]+\s*[-+]?)/i
const STMT_OPENING = /(old balance|opening balance|previous balance|ancien solde|alter saldo|saldo anterior)\s*[:.]?\s*([\d.,]+\s*[-+]?)/i
const STMT_PERIOD = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s*[-–—]\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/
const STMT_DATE = /\bdate\s*:\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i

/**
 * Pull the balances a current-account statement states about itself. Returns
 * nothing at all for anything else — a Revolut export or a card statement must
 * never move a bank account's balance.
 */
function readStatementSummary(
  lines: string[],
  transactions: Transaction[],
  dayFirst: boolean,
): StatementSummary | undefined {
  const text = lines.join('\n')
  if (!STMT_CURRENT.test(text)) return undefined
  const closingRaw = text.match(STMT_CLOSING)?.[2]
  const closingBalance = closingRaw ? cleanAmount(closingRaw) : null
  if (closingBalance == null) return undefined

  const openingRaw = text.match(STMT_OPENING)?.[2]
  const openingBalance = openingRaw ? cleanAmount(openingRaw) ?? undefined : undefined

  // Prefer the period's end date, then the statement's own date, then the last
  // row — in that order, because that is how precisely each states the day the
  // closing balance belongs to.
  const period = text.match(STMT_PERIOD)?.[2]
  const stated = text.match(STMT_DATE)?.[1]
  const asOf =
    (period && normalizeDate(period, dayFirst)) ||
    (stated && normalizeDate(stated, dayFirst)) ||
    transactions.map((t) => t.date).sort().pop() ||
    ''
  if (!asOf) return undefined

  const rowsTotal = Math.round(transactions.reduce((s, t) => s + t.amount, 0) * 100) / 100
  return {
    closingBalance,
    openingBalance,
    asOf,
    rowsTotal,
    complete:
      openingBalance == null
        ? undefined
        : Math.abs(openingBalance + rowsTotal - closingBalance) < 0.011,
  }
}

/** Exported for direct testing — the regex heuristics are the part worth proving. */
export function looksLikeName(s: string): boolean {
  const cleaned = s.replace(/[.,;]+$/, '').trim()
  return cleaned.length >= 3 && cleaned.length <= 60 && NAME_SHAPE.test(cleaned)
}

/**
 * Title-cases a name a statement shouted in capitals ("MARIA GARCIA" →
 * "Maria Garcia") so it reads like an account name. Left exactly as printed
 * if it isn't all-caps to begin with — no reason to second-guess a statement
 * that already wrote it in mixed case.
 */
export function tidyName(s: string): string {
  const cleaned = s.replace(/[.,;]+$/, '').trim().replace(/\s+/g, ' ')
  if (cleaned !== cleaned.toUpperCase()) return cleaned
  return cleaned.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase())
}

/**
 * The cardholder's name off a credit-card statement, if the layout states it
 * outright. Tried same-line first ("Titular: MARIA GARCIA"), then the next
 * line down — PDF text extraction often lands the label and the value on
 * separate visual lines even though the statement prints them together.
 */
function readLabelledCardholder(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CARDHOLDER_LABEL)
    if (!m) continue
    const sameLine = m[1]?.trim()
    if (sameLine && looksLikeName(sameLine)) return tidyName(sameLine)
    const next = lines[i + 1]?.trim()
    if (next && looksLikeName(next)) return tidyName(next)
  }
  return undefined
}

/**
 * Many card issuers never print a "Cardholder:" label at all — the name is
 * just the addressee of the letter, sitting above a street line and a
 * postcode-and-city line the way any posted mail does. Restricted to before
 * the transaction table starts, because a name-shaped line only means
 * something there — "Mi Tierra" or "Rituals Luxembourg" read exactly like a
 * name too, and the statement is full of them further down.
 */
function readAddressedCardholder(lines: string[]): string | undefined {
  const tableStart = lines.findIndex((l) => LINE_DATE.test(l) && LINE_AMOUNT.test(l))
  const header = tableStart === -1 ? lines : lines.slice(0, tableStart)
  for (let i = 0; i < header.length; i++) {
    if (!looksLikeName(header[i])) continue
    const after = header.slice(i + 1, i + 3)
    if (after.some((l) => ADDRESS_LINE.test(l.trim()))) return tidyName(header[i])
  }
  return undefined
}

export function readCardholderName(lines: string[]): string | undefined {
  return readLabelledCardholder(lines) ?? readAddressedCardholder(lines)
}

export async function parsePDFFile(file: File): Promise<ParsedResult> {
  const warnings: string[] = []
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const lines: string[] = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // Group text items into visual lines by their y position.
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      if (!item.str.trim()) continue
      const y = Math.round(item.transform[5])
      const x = item.transform[4]
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y)!.push({ x, s: item.str })
    }
    const sortedY = Array.from(rows.keys()).sort((a, b) => b - a)
    for (const y of sortedY) {
      const parts = rows.get(y)!.sort((a, b) => a.x - b.x).map((p) => p.s)
      lines.push(parts.join(' ').replace(/\s+/g, ' ').trim())
    }
  }

  // Infer the date convention once, from every line that looks like a
  // transaction, so the whole statement is read consistently.
  const dayFirst = inferDayFirst(
    lines.filter((l) => LINE_AMOUNT.test(l)).map((l) => l.match(LINE_DATE)?.[0]),
  )
  const dateStrip = new RegExp(LINE_DATE.source, 'g')

  const out: Transaction[] = []
  for (const line of lines) {
    const dateMatch = line.match(LINE_DATE)
    const amountMatch = line.match(LINE_AMOUNT)
    if (!dateMatch || !amountMatch) continue
    const date = normalizeDate(dateMatch[0], dayFirst)
    if (!date) continue
    let amount = cleanAmount(amountMatch[0])
    // Skip zero/blank amounts — they come from stray numbers, not real rows.
    if (amount == null || amount === 0) continue
    // A trailing "+"/CR marks a credit (money in), "-"/DR a debit; cleanAmount
    // already reads a sign embedded in the token.
    if (/(\+|cr)\s*$/i.test(amountMatch[0])) amount = Math.abs(amount)
    else if (/(-|dr)\s*$/i.test(amountMatch[0])) amount = -Math.abs(amount)

    // Drop every date token (booking and value dates) from the label.
    let description = line
      .replace(amountMatch[0], ' ')
      .replace(dateStrip, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!description) description = 'Transaction'

    out.push({
      id: uid(),
      date,
      description,
      amount,
      category: categorize(description, amount),
      source: 'pdf',
      month: date.slice(0, 7),
    })
  }

  const statement = readStatementSummary(lines, out, dayFirst)
  const source = sourceHint(lines.join('\n'), file.name)
  // Only trusted on something that already looks like a card statement — the
  // same word ("Titular", "Holder") shows up on plenty of other documents,
  // and it should never end up naming an account it has nothing to do with.
  const cardholderName = source === 'card' ? readCardholderName(lines) : undefined

  if (!out.length) {
    warnings.push(
      'No transactions detected. Some PDF statements are scanned images with no text layer — try exporting a CSV from your bank instead.',
    )
  } else if (statement?.complete) {
    // The statement's own arithmetic agrees, so every row was read. No need to
    // ask the user to double-check what the bank has already confirmed.
    warnings.push(
      'Every row checks out: the opening balance plus these rows lands exactly on the statement’s closing balance.',
    )
  } else {
    warnings.push('PDF parsing is best-effort. Please review the rows and signs before saving.')
  }
  return { transactions: out, warnings, statement, source, cardholderName }
}

/**
 * Which account a document is about. The card check comes first: a card
 * statement issued by the same bank often names the current account it is paid
 * from, and the card is the more specific claim.
 */
function sourceHint(text: string, filename: string): ParsedResult['source'] {
  const hay = `${filename}\n${text}`
  if (STMT_CARD.test(hay)) return 'card'
  if (STMT_REVOLUT.test(hay)) return 'revolut'
  if (STMT_CURRENT.test(hay)) return 'current'
  return undefined
}

export async function parseFile(file: File): Promise<ParsedResult> {
  if (/\.pdf$/i.test(file.name)) return parsePDFFile(file)
  return parseCSVFile(file)
}
