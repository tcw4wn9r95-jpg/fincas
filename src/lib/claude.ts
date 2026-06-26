import Anthropic from '@anthropic-ai/sdk'
import type { AppData, ChatMessage } from './types'
import { financialSummary } from './forecast'

// The assistant runs entirely from the browser using the user's own
// Anthropic API key (kept on-device). Their financial data is sent only
// to Anthropic's API when they ask a question — never to GitHub or any
// server we control.

function systemPrompt(data: AppData): string {
  const name = data.settings.name?.trim()
  return [
    'You are the CasaresSan Finances assistant, a calm, sharp personal financial advisor embedded in a private budgeting app.',
    name ? `You are speaking with ${name}.` : '',
    'You can see a snapshot of their finances below. Use it to give specific, numbers-grounded answers.',
    'Be concise and practical. Lead with the answer, then the reasoning. Use their figures and currency.',
    'When they ask what to do about upcoming expenses, reason about their projected balance, recurring commitments, and goals — and give a concrete recommendation, not a survey of options.',
    'You are an informational assistant, not a licensed financial professional; note big caveats briefly when relevant, without hedging every sentence.',
    'If a figure is missing from the snapshot, say so rather than inventing it.',
    '',
    '--- FINANCIAL SNAPSHOT ---',
    financialSummary(data),
    '--- END SNAPSHOT ---',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface StreamHandlers {
  onText: (delta: string) => void
  onDone: (full: string) => void
  onError: (message: string) => void
}

export function hasApiKey(data: AppData): boolean {
  return Boolean(data.settings.apiKey?.trim())
}

export async function askClaude(
  data: AppData,
  history: ChatMessage[],
  handlers: StreamHandlers,
): Promise<void> {
  const apiKey = data.settings.apiKey?.trim()
  if (!apiKey) {
    handlers.onError('Add your Anthropic API key in Settings to chat with the assistant.')
    return
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  try {
    const stream = client.messages.stream({
      model: data.settings.model || 'claude-opus-4-8',
      max_tokens: 1600,
      system: systemPrompt(data),
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    })

    stream.on('text', (delta) => handlers.onText(delta))
    const final = await stream.finalMessage()
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    handlers.onDone(text)
  } catch (err) {
    let message = 'Something went wrong talking to Claude.'
    if (err instanceof Anthropic.AuthenticationError) {
      message = 'Your API key was rejected. Check it in Settings.'
    } else if (err instanceof Anthropic.RateLimitError) {
      message = 'Rate limited by the API — wait a moment and try again.'
    } else if (err instanceof Anthropic.APIError) {
      message = `API error: ${err.message}`
    } else if (err instanceof Error) {
      message = err.message
    }
    handlers.onError(message)
  }
}
