import type { WebContents } from 'electron'
import {
  AI_PAGE_TEXT_LIMIT,
  SseDecoder,
  buildRequestBody,
  sseErrorMessage,
  sseTextDelta,
  type AiChatMessage,
  type AiModelId,
  type AiPageContext,
} from '../shared/ai'

export interface AiChatOptions {
  getSettings(): { apiKey: string; model: AiModelId }
  getActivePage(): WebContents | null
  send(channel: 'ai:delta' | 'ai:done' | 'ai:error', payload?: string): void
}

// slice inside the page so a pathological document doesn't ship megabytes
// over the executeJavaScript bridge
const EXTRACT_PAGE_TEXT = `(() => {
  const text = document.body ? document.body.innerText : ''
  return String(text).slice(0, ${AI_PAGE_TEXT_LIMIT + 1})
})()`

// One in-flight completion at a time; a new start() aborts the previous one.
// All Anthropic traffic lives in main so the API key never reaches a renderer
// and page views need no extra privileges.
export class AiChatController {
  private current: AbortController | null = null

  constructor(private opts: AiChatOptions) {}

  async start(messages: AiChatMessage[]): Promise<void> {
    this.stop()
    const { apiKey, model } = this.opts.getSettings()
    if (!apiKey) {
      this.opts.send('ai:error', 'Add your Anthropic API key in Settings → General first.')
      return
    }
    if (messages.length === 0 || messages[messages.length - 1]!.role !== 'user') {
      this.opts.send('ai:error', 'Nothing to send.')
      return
    }
    const ctrl = new AbortController()
    this.current = ctrl
    const page = await this.capturePageContext()
    if (ctrl.signal.aborted) return
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildRequestBody(model, messages, page)),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        this.finish(ctrl, 'ai:error', await describeHttpError(res))
        return
      }
      const decoder = new SseDecoder()
      const textDecoder = new TextDecoder()
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        if (this.current !== ctrl) return // superseded mid-stream
        for (const event of decoder.push(textDecoder.decode(chunk, { stream: true }))) {
          const error = sseErrorMessage(event)
          if (error !== null) {
            this.finish(ctrl, 'ai:error', error)
            return
          }
          const delta = sseTextDelta(event)
          if (delta !== null) this.opts.send('ai:delta', delta)
        }
      }
      this.finish(ctrl, 'ai:done')
    } catch (err) {
      // stop() nulled/replaced `current`, and the renderer commits the
      // partial answer itself on stop — nothing to send
      if (ctrl.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      this.finish(ctrl, 'ai:error', `Request failed: ${message}`)
    }
  }

  stop(): void {
    this.current?.abort()
    this.current = null
  }

  // only the still-current stream may talk to the renderer
  private finish(ctrl: AbortController, channel: 'ai:done' | 'ai:error', payload?: string): void {
    if (this.current !== ctrl) return
    this.current = null
    this.opts.send(channel, payload)
  }

  private async capturePageContext(): Promise<AiPageContext | null> {
    const wc = this.opts.getActivePage()
    if (!wc || wc.isDestroyed()) return null
    const url = wc.getURL()
    if (!/^https?:\/\//.test(url)) return null
    const text = await wc.executeJavaScript(EXTRACT_PAGE_TEXT).catch(() => '')
    return { url, title: wc.getTitle() || url, text: typeof text === 'string' ? text : '' }
  }
}

async function describeHttpError(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    // non-JSON error body; status alone will have to do
  }
  if (res.status === 401) return 'Invalid API key. Check Settings → General.'
  if (res.status === 429) return `Rate limited by the API${detail ? `: ${detail}` : '.'}`
  return detail || `API error (HTTP ${res.status}).`
}
