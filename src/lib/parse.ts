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
// Most statements carry a running balance. It is the bank's own figure for what
// the account held after the row, which beats anything derived from the
// transactions — no opening balance to guess, no drift.
const BALANCE_KEYS = /^(balance|saldo|running balance|balance after|closing balance)$/i

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
  const balanceF = pickField(fields, BALANCE_KEYS) ?? pickField(fields, /balance|saldo/i)

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

    const balanceAfter = balanceF ? cleanAmount(row[balanceF]) : null

    out.push({
      id: uid(),
      date,
      description: description.trim(),
      amount,
      category: categorize(description, amount),
      source: 'csv',
      month: date.slice(0, 7),
      ...(balanceAfter != null ? { balanceAfter } : {}),
    })
  }

  if (!out.length) warnings.push('No rows could be parsed. Check the date and amount columns.')
  return { transactions: out, warnings }
}

export async function parseCSVFile(file: File): Promise<ParsedResult> {
  return parseCSV(await file.text())
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

  if (!out.length) {
    warnings.push(
      'No transactions detected. Some PDF statements are scanned images with no text layer — try exporting a CSV from your bank instead.',
    )
  } else {
    warnings.push(
      'PDF parsing is best-effort. Please review the rows and signs before saving.',
    )
  }
  return { transactions: out, warnings }
}

export async function parseFile(file: File): Promise<ParsedResult> {
  if (/\.pdf$/i.test(file.name)) return parsePDFFile(file)
  return parseCSVFile(file)
}
