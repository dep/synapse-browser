import * as path from 'node:path'
import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth } from '../shared/sidebar-width'
import { JsonStore } from './store'

interface UiFile {
  v: 1
  sidebarWidth: number
  sidebarVisible: boolean
}

export class UiStore {
  private store: JsonStore<UiFile>

  constructor(dir: string) {
    this.store = new JsonStore<UiFile>(path.join(dir, 'ui.json'), {
      v: 1,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      sidebarVisible: true,
    })
  }

  // clamp on read too: the file is user-editable and may carry garbage
  sidebarWidth(): number {
    return clampSidebarWidth(this.store.get().sidebarWidth)
  }

  sidebarVisible(): boolean {
    return this.store.get().sidebarVisible !== false
  }

  setSidebarWidth(px: number): void {
    this.store.set({ ...this.normalized(), sidebarWidth: clampSidebarWidth(px) })
  }

  setSidebarVisible(visible: boolean): void {
    this.store.set({ ...this.normalized(), sidebarVisible: visible })
  }

  flush(): void {
    this.store.flush()
  }

  private normalized(): UiFile {
    return { v: 1, sidebarWidth: this.sidebarWidth(), sidebarVisible: this.sidebarVisible() }
  }
}
