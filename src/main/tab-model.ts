export type CycleList = 'mru' | 'order'
export type Direction = 'forward' | 'back'

export class TabModel {
  order: string[] = []
  pinned: string[] = []
  bookmarks: string[] = []
  mru: string[] = []
  activeId: string | null = null
  private cycling = false

  // pins and bookmarks are both "slots": they sleep instead of closing
  private isSlot(id: string): boolean {
    return this.pinned.includes(id) || this.bookmarks.includes(id)
  }

  add(id: string, activate = true): void {
    this.order.push(id)
    if (activate) {
      if (this.cycling) this.cycleCommit()
      this.mru.unshift(id)
      this.activeId = id
    } else {
      this.mru.push(id)
    }
  }

  activate(id: string): void {
    if (!this.order.includes(id) && !this.isSlot(id)) return
    if (this.isSlot(id) && !this.mru.includes(id)) return // asleep slots wake via wake()
    // an uncommitted cycle preview still counts as a visit
    if (this.cycling) this.cycleCommit()
    this.promote(id)
    this.activeId = id
  }

  close(id: string): void {
    const closedIndex = this.order.indexOf(id)
    if (closedIndex === -1) return // pins never close; they sleep
    if (this.cycling) this.cycleCommit()
    this.order = this.order.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) {
      // focus the tab that slid into the closed tab's spot (the one to the
      // right/below); if it was the last one, fall back to its new neighbor
      this.activeId = this.order[Math.min(closedIndex, this.order.length - 1)] ?? null
      if (this.activeId) this.promote(this.activeId)
    }
  }

  // a live tab becomes a pin in place: same id, same MRU standing
  pin(id: string): boolean {
    if (!this.order.includes(id)) return false
    this.order = this.order.filter((t) => t !== id)
    this.pinned.push(id)
    return true
  }

  // the pin falls out of the row to the top of the tab list; the caller
  // must wake a sleeping pin first so it re-enters as a live tab
  unpin(id: string): void {
    if (!this.pinned.includes(id)) return
    this.pinned = this.pinned.filter((t) => t !== id)
    this.order.unshift(id)
    if (!this.mru.includes(id)) this.mru.push(id)
  }

  // a pin restored from disk: present in the row, asleep (no MRU standing)
  addPin(id: string): void {
    this.pinned.push(id)
  }

  // a live tab becomes a bookmark slot in place: same id, same MRU standing
  bookmark(id: string): boolean {
    if (!this.order.includes(id)) return false
    this.order = this.order.filter((t) => t !== id)
    this.bookmarks.push(id)
    return true
  }

  // the slot falls back to the top of the tab list; only awake slots are
  // unbookmarked (⌘D acts on the active tab) but mirror unpin defensively
  unbookmark(id: string): void {
    if (!this.bookmarks.includes(id)) return
    this.bookmarks = this.bookmarks.filter((t) => t !== id)
    this.order.unshift(id)
    if (!this.mru.includes(id)) this.mru.push(id)
  }

  // a bookmark restored from the store: present as a slot, asleep
  addBookmark(id: string): void {
    this.bookmarks.push(id)
  }

  // the bookmark was deleted outright: slot and MRU standing both go
  removeBookmark(id: string): void {
    if (!this.bookmarks.includes(id)) return
    if (this.cycling) this.cycleCommit()
    this.bookmarks = this.bookmarks.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  // bookmark order is store-driven (folders first, then top level); the
  // manager syncs it here so cycling and at() match the sidebar
  setBookmarkOrder(ids: string[]): void {
    const known = new Set(this.bookmarks)
    this.bookmarks = ids.filter((id) => known.has(id))
  }

  isBookmarkSlot(id: string): boolean {
    return this.bookmarks.includes(id)
  }

  // move a tab within its own list (sidebar order or pin row); not a visit,
  // so MRU and activeId are untouched. toIndex is the insertion index after
  // removal; out-of-range clamps, unknown ids no-op.
  reorder(id: string, toIndex: number): void {
    const list = this.order.includes(id) ? this.order : this.pinned.includes(id) ? this.pinned : null
    if (!list) return
    list.splice(list.indexOf(id), 1)
    list.splice(Math.min(Math.max(toIndex, 0), list.length), 0, id)
  }

  wake(id: string, activate = true): void {
    if (!this.isSlot(id) || this.mru.includes(id)) return
    if (this.cycling) this.cycleCommit()
    if (activate) {
      this.mru.unshift(id)
      this.activeId = id
    } else {
      this.mru.push(id)
    }
  }

  sleep(id: string): void {
    if (!this.isSlot(id) || !this.mru.includes(id)) return
    if (this.cycling) this.cycleCommit()
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  isPinned(id: string): boolean {
    return this.pinned.includes(id)
  }

  isAwake(id: string): boolean {
    return this.mru.includes(id)
  }

  // index into pins → tabs (Cmd+1..9 addressing); bookmarks are deliberately
  // not addressable this way. Negative counts from the end.
  at(index: number): string | null {
    return [...this.pinned, ...this.order].at(index) ?? null
  }

  cycleStep(list: CycleList, dir: Direction): string | null {
    const ids =
      list === 'mru'
        ? this.mru
        : [
            ...this.pinned.filter((t) => this.mru.includes(t)),
            ...this.bookmarks.filter((t) => this.mru.includes(t)),
            ...this.order,
          ]
    if (ids.length < 2 || !this.activeId) return null
    const idx = ids.indexOf(this.activeId)
    const delta = dir === 'forward' ? 1 : -1
    const next = ids[(idx + delta + ids.length) % ids.length]
    this.activeId = next
    this.cycling = true
    return next
  }

  cycleCommit(): void {
    if (!this.cycling) return
    if (this.activeId) this.promote(this.activeId)
    this.cycling = false
  }

  isCycling(): boolean {
    return this.cycling
  }

  private promote(id: string): void {
    this.mru = this.mru.filter((t) => t !== id)
    this.mru.unshift(id)
  }
}
