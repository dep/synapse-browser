import { describe, expect, it } from 'vitest'
import {
  AI_MODEL_DEFAULT,
  AI_PAGE_TEXT_LIMIT,
  AI_SIDEBAR_WIDTH_DEFAULT,
  AI_SIDEBAR_WIDTH_MAX,
  AI_SIDEBAR_WIDTH_MIN,
  SseDecoder,
  buildRequestBody,
  buildSystemPrompt,
  clampAiSidebarWidth,
  normalizeAiModel,
  sanitizeMessages,
  sseErrorMessage,
  sseTextDelta,
} from '../src/shared/ai'

describe('normalizeAiModel', () => {
  it('passes known models through', () => {
    expect(normalizeAiModel('claude-haiku-4-5')).toBe('claude-haiku-4-5')
    expect(normalizeAiModel('claude-sonnet-5')).toBe('claude-sonnet-5')
  })

  it('falls back to the default for unknown or garbage input', () => {
    expect(normalizeAiModel('claude-sonnet-4-7')).toBe(AI_MODEL_DEFAULT)
    expect(normalizeAiModel(undefined)).toBe(AI_MODEL_DEFAULT)
    expect(normalizeAiModel(42)).toBe(AI_MODEL_DEFAULT)
  })
})

describe('clampAiSidebarWidth', () => {
  it('clamps to the min/max range', () => {
    expect(clampAiSidebarWidth(10)).toBe(AI_SIDEBAR_WIDTH_MIN)
    expect(clampAiSidebarWidth(10_000)).toBe(AI_SIDEBAR_WIDTH_MAX)
    expect(clampAiSidebarWidth(400)).toBe(400)
  })

  it('rounds and survives garbage', () => {
    expect(clampAiSidebarWidth(400.6)).toBe(401)
    expect(clampAiSidebarWidth(NaN)).toBe(AI_SIDEBAR_WIDTH_DEFAULT)
  })
})

describe('buildSystemPrompt', () => {
  it('omits page context when there is none', () => {
    expect(buildSystemPrompt(null)).not.toContain('URL:')
  })

  it('embeds title, url and text', () => {
    const p = buildSystemPrompt({ url: 'https://x.test/a', title: 'A page', text: 'hello world' })
    expect(p).toContain('Title: A page')
    expect(p).toContain('URL: https://x.test/a')
    expect(p).toContain('hello world')
    expect(p).not.toContain('(truncated)')
  })

  it('truncates oversized page text and says so', () => {
    const p = buildSystemPrompt({
      url: 'https://x.test',
      title: 't',
      text: 'x'.repeat(AI_PAGE_TEXT_LIMIT + 100),
    })
    expect(p).toContain('(truncated)')
    expect(p.length).toBeLessThan(AI_PAGE_TEXT_LIMIT + 1000)
  })
})

describe('sanitizeMessages', () => {
  it('keeps well-formed alternating messages', () => {
    const msgs = sanitizeMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
    expect(msgs).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('drops garbage, empty content, and unknown roles', () => {
    const msgs = sanitizeMessages([
      null,
      'nope',
      { role: 'system', content: 'sneaky' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'real' },
      { role: 'user', content: 7 },
    ])
    expect(msgs).toEqual([{ role: 'user', content: 'real' }])
  })

  it('returns [] for non-arrays', () => {
    expect(sanitizeMessages('x')).toEqual([])
    expect(sanitizeMessages(undefined)).toEqual([])
  })

  it('caps history length, keeping the most recent turns', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }))
    const msgs = sanitizeMessages(many)
    expect(msgs.length).toBeLessThan(60)
    expect(msgs[msgs.length - 1]!.content).toBe('m59')
  })
})

describe('buildRequestBody', () => {
  it('produces a streaming Messages API payload', () => {
    const body = buildRequestBody('claude-haiku-4-5', [{ role: 'user', content: 'hi' }], null) as {
      model: string
      stream: boolean
      max_tokens: number
      system: string
      messages: unknown[]
    }
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.messages).toHaveLength(1)
    expect(typeof body.system).toBe('string')
  })
})

describe('SseDecoder', () => {
  const delta = (text: string): string =>
    `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}\n\n`

  it('decodes complete events', () => {
    const d = new SseDecoder()
    const events = d.push(delta('Hello'))
    expect(events).toHaveLength(1)
    expect(sseTextDelta(events[0])).toBe('Hello')
  })

  it('buffers events split across chunks (mid-line and mid-event)', () => {
    const d = new SseDecoder()
    const full = delta('World')
    expect(d.push(full.slice(0, 30))).toHaveLength(0)
    expect(d.push(full.slice(30, full.length - 1))).toHaveLength(0)
    const events = d.push(full.slice(full.length - 1))
    expect(events).toHaveLength(1)
    expect(sseTextDelta(events[0])).toBe('World')
  })

  it('decodes multiple events in one chunk and keeps the tail buffered', () => {
    const d = new SseDecoder()
    const events = d.push(delta('a') + delta('b') + 'event: content_block_delta\ndata: {"par')
    expect(events.map(sseTextDelta)).toEqual(['a', 'b'])
    const rest = d.push('tial":1}\n\n')
    expect(rest).toHaveLength(1)
  })

  it('handles CRLF line endings', () => {
    const d = new SseDecoder()
    const events = d.push(
      'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n',
    )
    expect(events).toEqual([{ type: 'message_stop' }])
  })

  it('skips pings, comments, and malformed JSON without dying', () => {
    const d = new SseDecoder()
    const events = d.push(
      ': comment\n\n' + 'data: {not json}\n\n' + 'event: ping\ndata: {"type":"ping"}\n\n' + delta('ok'),
    )
    expect(events.map(sseTextDelta)).toEqual([null, 'ok'])
  })
})

describe('sse helpers', () => {
  it('extracts error messages from error events', () => {
    expect(
      sseErrorMessage({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ).toBe('Overloaded')
    expect(sseErrorMessage({ type: 'message_stop' })).toBeNull()
  })

  it('ignores non-text deltas (thinking)', () => {
    expect(
      sseTextDelta({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } }),
    ).toBeNull()
  })
})
