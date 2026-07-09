import type { ProfileId } from '../shared/ipc'

export interface ClosedTab {
  url: string
  profile: ProfileId
  index: number // sidebar position at close time, for restore-in-place
}

// bounded LIFO of recently closed tabs (Cmd+Shift+T); pins and bookmark
// slots never land here — they sleep instead of closing
export class ClosedTabsStack {
  private items: ClosedTab[] = []

  constructor(private cap = 25) {}

  push(tab: ClosedTab): void {
    if (!/^https?:\/\//.test(tab.url)) return // blank/error tabs have nothing to restore
    this.items.push(tab)
    if (this.items.length > this.cap) this.items.shift()
  }

  pop(): ClosedTab | undefined {
    return this.items.pop()
  }
}
