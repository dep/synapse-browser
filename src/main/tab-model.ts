export type CycleList = 'mru' | 'order'
export type Direction = 'forward' | 'back'

export class TabModel {
  order: string[] = []
  pinned: string[] = []
  mru: string[] = []
  activeId: string | null = null
  private cycling = false

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
    if (!this.order.includes(id) && !this.pinned.includes(id)) return
    // an uncommitted cycle preview still counts as a visit
    if (this.cycling) this.cycleCommit()
    this.promote(id)
    this.activeId = id
  }

  close(id: string): void {
    if (!this.order.includes(id)) return // pins never close; they sleep
    if (this.cycling) this.cycleCommit()
    this.order = this.order.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  // a live tab becomes a pin in place: same id, same MRU standing
  pin(id: string): void {
    if (!this.order.includes(id)) return
    this.order = this.order.filter((t) => t !== id)
    this.pinned.push(id)
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

  wake(id: string, activate = true): void {
    if (!this.pinned.includes(id) || this.mru.includes(id)) return
    if (activate) {
      if (this.cycling) this.cycleCommit()
      this.mru.unshift(id)
      this.activeId = id
    } else {
      this.mru.push(id)
    }
  }

  sleep(id: string): void {
    if (!this.pinned.includes(id) || !this.mru.includes(id)) return
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

  // index into pins-then-tabs; negative counts from the end (-1 = last)
  at(index: number): string | null {
    return [...this.pinned, ...this.order].at(index) ?? null
  }

  cycleStep(list: CycleList, dir: Direction): string | null {
    const ids =
      list === 'mru'
        ? this.mru
        : [...this.pinned.filter((t) => this.mru.includes(t)), ...this.order]
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
