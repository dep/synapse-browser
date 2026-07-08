import * as path from 'node:path'
import { resolveShortcuts } from '../shared/shortcuts'
import { JsonStore } from './store'

interface ShortcutsFile {
  v: 1
  overrides: Record<string, string>
}

export class ShortcutsStore {
  private store: JsonStore<ShortcutsFile>

  constructor(dir: string) {
    this.store = new JsonStore<ShortcutsFile>(path.join(dir, 'shortcuts.json'), {
      v: 1,
      overrides: {},
    })
  }

  overrides(): Record<string, string> {
    const o = this.store.get().overrides
    return o && typeof o === 'object' ? o : {}
  }

  resolved(): Record<string, string> {
    return resolveShortcuts(this.overrides())
  }

  set(id: string, accelerator: string): void {
    this.store.set({ v: 1, overrides: { ...this.overrides(), [id]: accelerator } })
  }

  reset(id: string): void {
    const next = { ...this.overrides() }
    delete next[id]
    this.store.set({ v: 1, overrides: next })
  }

  resetAll(): void {
    this.store.set({ v: 1, overrides: {} })
  }

  flush(): void {
    this.store.flush()
  }
}
