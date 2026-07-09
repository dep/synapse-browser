// Pure, Electron-free logic for the AI sidebar: model catalog, request
// construction for the Anthropic Messages API, and SSE stream decoding.

export const AI_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
] as const

export type AiModelId = (typeof AI_MODELS)[number]['id']

export const AI_MODEL_DEFAULT: AiModelId = 'claude-opus-4-8'

export function normalizeAiModel(id: unknown): AiModelId {
  return AI_MODELS.some((m) => m.id === id) ? (id as AiModelId) : AI_MODEL_DEFAULT
}

export const AI_SIDEBAR_WIDTH_DEFAULT = 360
export const AI_SIDEBAR_WIDTH_MIN = 260
export const AI_SIDEBAR_WIDTH_MAX = 640

export function clampAiSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return AI_SIDEBAR_WIDTH_DEFAULT
  return Math.min(AI_SIDEBAR_WIDTH_MAX, Math.max(AI_SIDEBAR_WIDTH_MIN, Math.round(px)))
}

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiPageContext {
  url: string
  title: string
  text: string
}

// keeps page context to roughly 8-10k tokens so chat history still fits
export const AI_PAGE_TEXT_LIMIT = 30_000
export const AI_MAX_TOKENS = 8192
export const AI_HISTORY_LIMIT = 24

export function buildSystemPrompt(page: AiPageContext | null): string {
  const base =
    'You are the AI assistant built into Synapse Browser. ' +
    'Help the user with the page they are viewing and with general questions. ' +
    'Be concise and answer in plain text without markdown formatting.'
  if (!page) return base
  const truncated = page.text.length > AI_PAGE_TEXT_LIMIT
  const text = page.text.slice(0, AI_PAGE_TEXT_LIMIT)
  return (
    `${base}\n\nThe user is currently viewing this page:\n` +
    `Title: ${page.title}\nURL: ${page.url}\n` +
    `Page content${truncated ? ' (truncated)' : ''}:\n"""\n${text}\n"""`
  )
}

// drops malformed entries, empty content (the API rejects empty text blocks),
// and everything older than the history window
export function sanitizeMessages(input: unknown): AiChatMessage[] {
  if (!Array.isArray(input)) return []
  const clean = input.filter(
    (m): m is AiChatMessage =>
      !!m &&
      typeof m === 'object' &&
      ((m as AiChatMessage).role === 'user' || (m as AiChatMessage).role === 'assistant') &&
      typeof (m as AiChatMessage).content === 'string' &&
      (m as AiChatMessage).content.trim().length > 0,
  )
  return clean
    .slice(-AI_HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }))
}

export function buildRequestBody(
  model: AiModelId,
  messages: AiChatMessage[],
  page: AiPageContext | null,
): object {
  return {
    model,
    max_tokens: AI_MAX_TOKENS,
    system: buildSystemPrompt(page),
    messages,
    stream: true,
  }
}

// Incremental Server-Sent-Events decoder. Feed it raw chunks; it returns the
// JSON payload of each completed `data:` event and buffers partial ones.
export class SseDecoder {
  private buffer = ''

  push(chunk: string): unknown[] {
    this.buffer += chunk
    const events: unknown[] = []
    // an SSE event ends at a blank line; keep the unterminated tail buffered
    for (;;) {
      const boundary = this.buffer.search(/\r?\n\r?\n/)
      if (boundary === -1) break
      const raw = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        events.push(JSON.parse(data))
      } catch {
        // malformed frame; skip rather than kill the stream
      }
    }
    return events
  }
}

// returns the text delta carried by a decoded stream event, or null
export function sseTextDelta(event: unknown): string | null {
  const e = event as {
    type?: string
    delta?: { type?: string; text?: string }
  }
  if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
    return typeof e.delta.text === 'string' ? e.delta.text : null
  }
  return null
}

// returns the error message carried by a decoded `error` event, or null
export function sseErrorMessage(event: unknown): string | null {
  const e = event as { type?: string; error?: { message?: string } }
  if (e?.type === 'error') return e.error?.message ?? 'Unknown API error'
  return null
}
