import type { AiChatMessage } from '../shared/ai'

export interface AiSidebar {
  // called when main pushes visibility; focuses the composer on show
  setVisible(visible: boolean): void
}

const SUGGESTIONS = ['Summarize this page', 'What are the key takeaways?', 'Explain this simply']

export function initAiSidebar(): AiSidebar {
  const messagesEl = document.getElementById('ai-messages')!
  const form = document.getElementById('ai-composer') as HTMLFormElement
  const input = document.getElementById('ai-input') as HTMLTextAreaElement
  const sendBtn = document.getElementById('ai-send') as HTMLButtonElement
  const clearBtn = document.getElementById('ai-clear') as HTMLButtonElement

  // the transcript sent to the API; error notes and pending bubbles stay out
  let history: AiChatMessage[] = []
  let streaming = false
  let liveEl: HTMLElement | null = null
  let liveText = ''

  function updateComposer(): void {
    sendBtn.textContent = streaming ? '■' : '↑'
    sendBtn.title = streaming ? 'Stop' : 'Send (Enter)'
    sendBtn.classList.toggle('stop', streaming)
    sendBtn.disabled = !streaming && input.value.trim().length === 0
  }

  function nearBottom(): boolean {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 48
  }

  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function appendBubble(role: 'user' | 'assistant', text: string): HTMLElement {
    const el = document.createElement('div')
    el.className = `ai-msg ${role}`
    el.textContent = text
    messagesEl.append(el)
    scrollToBottom()
    return el
  }

  function appendError(message: string): void {
    const el = document.createElement('div')
    el.className = 'ai-error'
    const text = document.createElement('span')
    text.textContent = message
    el.append(text)
    if (/API key|Settings/i.test(message)) {
      const btn = document.createElement('button')
      btn.className = 'ai-error-action'
      btn.textContent = 'Open Settings'
      btn.addEventListener('click', () => window.synapse.settings.open())
      el.append(btn)
    }
    messagesEl.append(el)
    scrollToBottom()
  }

  function renderEmptyState(): void {
    messagesEl.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.id = 'ai-empty'
    const hint = document.createElement('p')
    hint.textContent = 'Ask anything about the page you’re viewing.'
    wrap.append(hint)
    const chips = document.createElement('div')
    chips.className = 'ai-chips'
    for (const s of SUGGESTIONS) {
      const chip = document.createElement('button')
      chip.className = 'ai-chip'
      chip.textContent = s
      chip.addEventListener('click', () => send(s))
      chips.append(chip)
    }
    wrap.append(chips)
    // no key yet → point at settings before the first failed request
    void window.synapse.settings.get().then(({ apiKey }) => {
      if (apiKey || history.length > 0) return
      const setup = document.createElement('div')
      setup.className = 'ai-setup'
      const note = document.createElement('span')
      note.textContent = 'Add your Anthropic API key to get started.'
      const btn = document.createElement('button')
      btn.className = 'ai-error-action'
      btn.textContent = 'Open Settings'
      btn.addEventListener('click', () => window.synapse.settings.open())
      setup.append(note, btn)
      wrap.prepend(setup)
    })
    messagesEl.append(wrap)
  }

  function send(text: string): void {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    document.getElementById('ai-empty')?.remove()
    history.push({ role: 'user', content: trimmed })
    appendBubble('user', trimmed)
    liveEl = appendBubble('assistant', '')
    liveEl.classList.add('pending')
    liveText = ''
    streaming = true
    input.value = ''
    updateComposer()
    window.synapse.ai.send(history)
  }

  // an aborted or errored stream keeps whatever text already arrived
  function commitLive(): void {
    if (liveText) history.push({ role: 'assistant', content: liveText })
    else liveEl?.remove()
    liveEl = null
    liveText = ''
    streaming = false
    updateComposer()
  }

  window.synapse.ai.onDelta((text) => {
    if (!streaming || !liveEl) return
    const stick = nearBottom()
    liveEl.classList.remove('pending')
    liveText += text
    liveEl.textContent = liveText
    if (stick) scrollToBottom()
  })

  window.synapse.ai.onDone(() => {
    if (streaming) commitLive()
  })

  window.synapse.ai.onError((message) => {
    if (streaming) commitLive()
    appendError(message)
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (streaming) {
      // commit locally right away — main aborts silently, so no ai:done follows
      window.synapse.ai.stop()
      commitLive()
    } else {
      send(input.value)
    }
  })

  input.addEventListener('input', updateComposer)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming) send(input.value)
    }
  })

  clearBtn.addEventListener('click', () => {
    if (streaming) window.synapse.ai.stop()
    streaming = false
    liveEl = null
    liveText = ''
    history = []
    renderEmptyState()
    updateComposer()
  })

  renderEmptyState()
  updateComposer()

  return {
    setVisible(visible: boolean) {
      if (!visible) return
      if (history.length === 0) renderEmptyState() // re-check the API key hint
      input.focus()
    },
  }
}
