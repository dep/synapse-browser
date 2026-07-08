import * as path from 'node:path'
import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth } from '../shared/sidebar-width'
import { JsonStore } from './store'

interface UiFile {
  v: 1
  sidebarWidth: number
}

export class UiStore {
  private store: JsonStore<UiFile>

  constructor(dir: string) {
    this.store = new JsonStore<UiFile>(path.join(dir, 'ui.json'), {
      v: 1,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    })
  }

  // clamp on read too: the file is user-editable and may carry garbage
  sidebarWidth(): number {
    return clampSidebarWidth(this.store.get().sidebarWidth)
  }

  setSidebarWidth(px: number): void {
    this.store.set({ v: 1, sidebarWidth: clampSidebarWidth(px) })
  }

  flush(): void {
    this.store.flush()
  }
}
