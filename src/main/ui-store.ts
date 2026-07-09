import * as path from 'node:path'
import { AI_SIDEBAR_WIDTH_DEFAULT, clampAiSidebarWidth } from '../shared/ai'
import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth } from '../shared/sidebar-width'
import { JsonStore } from './store'

interface UiFile {
  v: 1
  sidebarWidth: number
  sidebarVisible: boolean
  aiSidebarWidth: number
  aiSidebarVisible: boolean
}

export class UiStore {
  private store: JsonStore<UiFile>

  constructor(dir: string) {
    this.store = new JsonStore<UiFile>(path.join(dir, 'ui.json'), {
      v: 1,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      sidebarVisible: true,
      aiSidebarWidth: AI_SIDEBAR_WIDTH_DEFAULT,
      aiSidebarVisible: false,
    })
  }

  // clamp on read too: the file is user-editable and may carry garbage
  sidebarWidth(): number {
    return clampSidebarWidth(this.store.get().sidebarWidth)
  }

  sidebarVisible(): boolean {
    return this.store.get().sidebarVisible !== false
  }

  aiSidebarWidth(): number {
    return clampAiSidebarWidth(this.store.get().aiSidebarWidth)
  }

  aiSidebarVisible(): boolean {
    return this.store.get().aiSidebarVisible === true
  }

  setSidebarWidth(px: number): void {
    this.store.set({ ...this.normalized(), sidebarWidth: clampSidebarWidth(px) })
  }

  setSidebarVisible(visible: boolean): void {
    this.store.set({ ...this.normalized(), sidebarVisible: visible })
  }

  setAiSidebarWidth(px: number): void {
    this.store.set({ ...this.normalized(), aiSidebarWidth: clampAiSidebarWidth(px) })
  }

  setAiSidebarVisible(visible: boolean): void {
    this.store.set({ ...this.normalized(), aiSidebarVisible: visible })
  }

  flush(): void {
    this.store.flush()
  }

  private normalized(): UiFile {
    return {
      v: 1,
      sidebarWidth: this.sidebarWidth(),
      sidebarVisible: this.sidebarVisible(),
      aiSidebarWidth: this.aiSidebarWidth(),
      aiSidebarVisible: this.aiSidebarVisible(),
    }
  }
}
