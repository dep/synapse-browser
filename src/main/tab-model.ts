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
  // tab → tab-group; only order tabs are groupable, and a group's members
  // stay contiguous in `order` (normalizeGroups) so the sidebar, Option+Tab
  // cycling, and Close Tabs Below all agree on one sequence
  private groups = new Map<string, string>()

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
      // slot in right behind the active tab so a fresh cmd+click tab is the
      // first Ctrl+Tab target (not the least-recently-used)
      const anchor = this.activeId ? this.mru.indexOf(this.activeId) : -1
      if (anchor === -1) this.mru.push(id)
      else this.mru.splice(anchor + 1, 0, id)
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
    this.groups.delete(id)
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
    this.groups.delete(id) // slots live above the tab list, outside any group
    this.order = this.order.filter((t) => t !== id)
    slots.push(id)
    return true
  }

  // ── tab groups ───────────────────────────────────────────────────────

  groupOf(id: string): string | null {
    return this.groups.get(id) ?? null
  }

  groupTabs(groupId: string): string[] {
    return this.order.filter((t) => this.groups.get(t) === groupId)
  }

  // distinct groups in sidebar order (position of each group's first member)
  groupIds(): string[] {
    const seen: string[] = []
    for (const t of this.order) {
      const g = this.groups.get(t)
      if (g && !seen.includes(g)) seen.push(g)
    }
    return seen
  }

  // join (or leave, with null) a group in place; membership only — the
  // contiguity sweep decides the final resting position
  setGroup(id: string, groupId: string | null): void {
    if (!this.order.includes(id)) return
    const from = this.groups.get(id) ?? null
    if (from === groupId) return
    if (groupId === null) {
      // leave: step just past the old block so the tab visibly exits it
      this.groups.delete(id)
      const block = this.groupTabs(from!)
      const last = block[block.length - 1]
      if (last !== undefined) {
        this.order = this.order.filter((t) => t !== id)
        this.order.splice(this.order.indexOf(last) + 1, 0, id)
      }
    } else {
      this.groups.set(id, groupId)
    }
    this.normalizeGroups()
  }

  // group a multi-selection (issue #37): membership lands in sidebar order —
  // selection click-order must not matter — and the contiguity sweep settles
  // the block at its first member's position. Unknown ids and slots drop out.
  groupMany(ids: string[], groupId: string): void {
    const joining = this.order.filter((t) => ids.includes(t) && this.groups.get(t) !== groupId)
    if (joining.length === 0) return
    // an existing block stays put: joiners file in behind its last member.
    // A brand-new group instead anchors at its first member's position.
    const existing = this.groupTabs(groupId)
    const anchor = existing[existing.length - 1]
    if (anchor !== undefined) {
      this.order = this.order.filter((t) => !joining.includes(t))
      this.order.splice(this.order.indexOf(anchor) + 1, 0, ...joining)
    }
    for (const id of joining) this.groups.set(id, groupId)
    this.normalizeGroups()
  }

  // multi-select drag (issue #37): move the whole selection as one block,
  // preserving sidebar order. toIndex is the insertion index after removal;
  // group mirrors reorder() (undefined keep, null clear, id join).
  moveMany(ids: string[], toIndex: number, group?: string | null): void {
    const moving = this.order.filter((t) => ids.includes(t))
    if (moving.length === 0) return
    const rest = this.order.filter((t) => !moving.includes(t))
    rest.splice(Math.min(Math.max(Math.round(toIndex), 0), rest.length), 0, ...moving)
    this.order = rest
    if (group !== undefined) {
      for (const id of moving) {
        if (group === null) this.groups.delete(id)
        else this.groups.set(id, group)
      }
    }
    this.normalizeGroups()
  }

  // "Ungroup Tabs": every membership goes, every tab keeps its position
  dissolveGroup(groupId: string): void {
    for (const [t, g] of [...this.groups]) if (g === groupId) this.groups.delete(t)
  }

  // move a whole group block; toIndex is the insertion index after removal
  moveGroup(groupId: string, toIndex: number): void {
    const members = this.groupTabs(groupId)
    if (members.length === 0) return
    const rest = this.order.filter((t) => this.groups.get(t) !== groupId)
    rest.splice(Math.min(Math.max(Math.round(toIndex), 0), rest.length), 0, ...members)
    this.order = rest
    this.normalizeGroups()
  }

  // restore the invariant: each group's members sit contiguously at the
  // position of its first member, relative order preserved. Ungrouped tabs
  // caught inside a block surface right after it.
  private normalizeGroups(): void {
    const emitted = new Set<string>()
    const next: string[] = []
    for (const t of this.order) {
      if (emitted.has(t)) continue
      const g = this.groups.get(t)
      if (!g) {
        next.push(t)
        emitted.add(t)
        continue
      }
      for (const member of this.groupTabs(g)) {
        next.push(member)
        emitted.add(member)
      }
    }
    this.order = next
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
  // removal; out-of-range clamps, unknown ids no-op. For tab-list tabs,
  // `group` is the drop target's group (null = ungrouped, undefined = keep);
  // the contiguity sweep then settles the final position.
  reorder(id: string, toIndex: number, group?: string | null): void {
    const list = this.order.includes(id) ? this.order : this.pinned.includes(id) ? this.pinned : null
    if (!list) return
    list.splice(list.indexOf(id), 1)
    list.splice(Math.min(Math.max(toIndex, 0), list.length), 0, id)
    if (list === this.order) {
      if (group !== undefined) {
        if (group === null) this.groups.delete(id)
        else this.groups.set(id, group)
      }
      this.normalizeGroups()
    }
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

  // full sidebar traversal order: awake pins, then awake bookmark slots, then
  // the tab list — asleep slots wake via click/Cmd+1..9, never in passing
  private orderCycleIds(): string[] {
    return [
      ...this.pinned.filter((t) => this.mru.includes(t)),
      ...this.bookmarks.filter((t) => this.mru.includes(t)),
      ...this.order,
    ]
  }

  // immediate prev/next in full sidebar order with wraparound — the
  // no-preview counterpart of cycleStep('order')
  sibling(dir: 1 | -1): string | null {
    const ids = this.orderCycleIds()
    if (ids.length === 0) return null
    const i = this.activeId ? ids.indexOf(this.activeId) : -1
    if (i === -1) return (dir === 1 ? ids[0] : ids[ids.length - 1]) ?? null
    return ids[(i + dir + ids.length) % ids.length] ?? null
  }

  cycleStep(list: CycleList, dir: Direction): string | null {
    const ids = list === 'mru' ? this.mru : this.orderCycleIds()
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
