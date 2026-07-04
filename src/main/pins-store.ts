import * as path from 'node:path'
import type { PinSlot } from '../shared/ipc'
import { JsonStore } from './store'

interface PinsFile {
  v: 1
  pins: PinSlot[]
}

// pins are only ever real web pages; anything else has no url to restore to
const PERSISTABLE = /^https?:\/\//

export class PinsStore {
  private store: JsonStore<PinsFile>

  constructor(dir: string) {
    this.store = new JsonStore<PinsFile>(path.join(dir, 'pins.json'), { v: 1, pins: [] })
  }

  save(pins: PinSlot[]): void {
    this.store.set({ v: 1, pins: pins.filter((p) => PERSISTABLE.test(p.url)) })
  }

  load(): PinSlot[] {
    const { pins } = this.store.get()
    return (Array.isArray(pins) ? pins : [])
      .filter((p): p is PinSlot => !!p && typeof p === 'object' && typeof (p as PinSlot).url === 'string')
      .filter((p) => PERSISTABLE.test(p.url))
      .map((p) => ({
        url: p.url,
        title: typeof p.title === 'string' ? p.title : p.url,
        favicon: typeof p.favicon === 'string' ? p.favicon : null,
      }))
  }

  flush(): void {
    this.store.flush()
  }
}
