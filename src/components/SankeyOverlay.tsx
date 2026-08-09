import type { SankeyGraph } from '../lib/sankey'
import { SankeyChart } from './SankeyChart'
import { Portal } from './Portal'
import { IconClose, IconInsights } from './icons'

/** The Sankey diagram's full-page detail view: a bigger chart plus a written read of the same figures. */
export function SankeyOverlay({
  graph,
  currency,
  locale,
  title,
  subtitle,
  insights,
  onClose,
}: {
  graph: SankeyGraph
  currency: string
  locale: string
  title: string
  subtitle: string
  insights: string[]
  onClose: () => void
}) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
        <div className="bg-paper w-full sm:max-w-3xl sm:rounded-xl2 rounded-t-xl2 shadow-lift max-h-[94vh] flex flex-col">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl">{title}</h2>
              <p className="text-sm text-muted">{subtitle}</p>
            </div>
            <button className="btn-subtle p-2 shrink-0" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          </div>
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-6">
            <SankeyChart graph={graph} currency={currency} locale={locale} />
            {insights.length > 0 && (
              <div className="border-t border-line pt-5">
                <h3 className="text-lg mb-3 flex items-center gap-2">
                  <IconInsights width={18} height={18} className="text-forest" /> Insights
                </h3>
                <ul className="space-y-2.5">
                  {insights.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-ink leading-relaxed">
                      <span className="text-forest shrink-0">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  )
}
