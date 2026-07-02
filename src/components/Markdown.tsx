import type { ReactNode } from 'react'

// Minimal markdown renderer for assistant replies — bold, italics, inline
// code, headings, lists, paragraphs. Builds React nodes directly (no HTML
// injection), so model output can never smuggle markup into the page.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Tokenize on **bold**, *italic* and `code`
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}b${i}`}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      out.push(
        <code key={`${keyBase}c${i}`} className="bg-forest-tint/70 rounded px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      )
    } else {
      out.push(<em key={`${keyBase}i${i}`}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let k = 0

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p${k++}`} className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">
          {inline(para.join(' '), `p${k}`)}
        </p>,
      )
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      const L = list
      blocks.push(
        L.ordered ? (
          <ol key={`l${k++}`} className="my-1.5 ml-5 list-decimal space-y-1">
            {L.items.map((it, j) => (
              <li key={j}>{inline(it, `l${k}-${j}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={`l${k++}`} className="my-1.5 ml-5 list-disc space-y-1">
            {L.items.map((it, j) => (
              <li key={j}>{inline(it, `l${k}-${j}`)}</li>
            ))}
          </ul>
        ),
      )
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    const heading = trimmed.match(/^(#{1,4})\s+(.*)/)
    const bullet = trimmed.match(/^[-*•]\s+(.*)/)
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)/)

    if (!trimmed) {
      flushPara()
      flushList()
    } else if (heading) {
      flushPara()
      flushList()
      blocks.push(
        <p key={`h${k++}`} className="mt-2.5 mb-1 first:mt-0 font-semibold text-ink">
          {inline(heading[2], `h${k}`)}
        </p>,
      )
    } else if (bullet) {
      flushPara()
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1])
    } else if (numbered) {
      flushPara()
      if (!list || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(numbered[1])
    } else {
      flushList()
      para.push(trimmed)
    }
  }
  flushPara()
  flushList()

  return <>{blocks}</>
}
