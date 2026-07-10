export type CycleList = 'mru' | 'order'
export type Direction = 'forward' | 'back'

export class TabModel {
  order: string[] = []
  pinned: string[] = []
  bookmarks: string[] = []
  mru: string[] = []
  activeId: string | null = null
  private cycling = false
  private cycleOrigin: string | null = null
  // tab → the tab that spawned it (cmd+click, window.open); the link lives
  // only until the user leaves the spawned tab for any other tab, so closing
  // it "immediately" returns focus to the opener instead of the neighbor
  private openers = new Map<string, string>()

  // pins and bookmarks are both "slots": they sleep instead of closing
  isSlot(id: string): boolean {
    return this.pinned.includes(id) || this.bookmarks.includes(id)
  }

  // moving to `next` ends the departing tab's "just spawned" grace window
  private leaveActive(next: string): void {
    if (this.activeId && this.activeId !== next) this.openers.delete(this.activeId)
  }

  // every user-driven focus move funnels through here so leaving a tab
  // reliably ends its grace window
  private switchTo(id: string): void {
    this.leaveActive(id)
    this.promote(id)
    this.activeId = id
  }

  add(id: string, activate = true, opener?: string | null): void {
    if (opener) this.openers.set(id, opener)
    this.order.push(id)
    if (activate) {
      if (this.cycling) this.cycleCommit()
      this.switchTo(id)
    } else {
      this.mru.push(id)
    }
  }

  activate(id: string): void {
    if (!this.order.includes(id) && !this.isSlot(id)) return
    if (this.isSlot(id) && !this.mru.includes(id)) return // asleep slots wake via wake()
    // an uncommitted cycle preview still counts as a visit
    if (this.cycling) this.cycleCommit()
    this.switchTo(id)
  }

  close(id: string): void {
    const closedIndex = this.order.indexOf(id)
    if (closedIndex === -1) return // pins never close; they sleep
    if (this.cycling) this.cycleCommit()
    const opener = this.openers.get(id)
    this.openers.delete(id)
    this.order = this.order.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) {
      // a still-fresh spawned tab hands focus back to its opener (mru
      // membership ⇔ awake, so closed openers and asleep slots fall through);
      // otherwise focus the tab that slid into the closed tab's spot (the one
      // to the right/below), or its new neighbor if it was the last one
      this.activeId =
        opener && this.isAwake(opener)
          ? opener
          : (this.order[Math.min(closedIndex, this.order.length - 1)] ?? null)
      if (this.activeId) this.promote(this.activeId)
    }
  }

  // a live tab becomes a slot in place: same id, same MRU standing
  private toSlot(id: string, slots: string[]): boolean {
    if (!this.order.includes(id)) return false
    this.openers.delete(id) // a slot is a keeper, not a just-spawned tab
    this.order = this.order.filter((t) => t !== id)
    slots.push(id)
    return true
  }

  pin(id: string): boolean {
    return this.toSlot(id, this.pinned)
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

  bookmark(id: string): boolean {
    return this.toSlot(id, this.bookmarks)
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

  // bulk-close selections (Close Tabs Below/Above, Close Other Tabs). Slots
  // render above the tab list in the sidebar, so from a slot every order tab
  // is "below"/"other" and none are "above"; unknown ids select nothing.
  tabsBelow(id: string): string[] {
    if (this.isSlot(id)) return [...this.order]
    const i = this.order.indexOf(id)
    return i === -1 ? [] : this.order.slice(i + 1)
  }

  tabsAbove(id: string): string[] {
    const i = this.order.indexOf(id)
    return i === -1 ? [] : this.order.slice(0, i)
  }

  otherTabs(id: string): string[] {
    if (this.isSlot(id)) return [...this.order]
    return this.order.includes(id) ? this.order.filter((t) => t !== id) : []
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
      this.switchTo(id)
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
    if (!this.cycling) this.cycleOrigin = this.activeId
    const idx = ids.indexOf(this.activeId)
    const delta = dir === 'forward' ? 1 : -1
    const next = ids[(idx + delta + ids.length) % ids.length]
    this.activeId = next
    this.cycling = true
    return next
  }

  cycleCommit(): void {
    if (!this.cycling) return
    // a walk is one focus move from origin to landing tab: tabs previewed in
    // passing keep their opener grace, and a round trip back to the origin
    // keeps its own
    if (this.cycleOrigin && this.cycleOrigin !== this.activeId) {
      this.openers.delete(this.cycleOrigin)
    }
    this.cycleOrigin = null
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
