export type CycleList = 'mru' | 'order'
export type Direction = 'forward' | 'back'

export class TabModel {
  order: string[] = []
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
    if (!this.order.includes(id)) return
    // an uncommitted cycle preview still counts as a visit
    if (this.cycling) this.cycleCommit()
    this.promote(id)
    this.activeId = id
  }

  close(id: string): void {
    if (!this.order.includes(id)) return
    if (this.cycling) this.cycleCommit()
    this.order = this.order.filter((t) => t !== id)
    this.mru = this.mru.filter((t) => t !== id)
    if (this.activeId === id) this.activeId = this.mru[0] ?? null
  }

  cycleStep(list: CycleList, dir: Direction): string | null {
    const ids = list === 'mru' ? this.mru : this.order
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
