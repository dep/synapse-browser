export interface PinSlot {
  url: string
  title: string
  favicon: string | null
}

export interface TabInfo {
  id: string
  title: string
  url: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isBookmarked: boolean
  isPinned: boolean
  isAsleep: boolean
  pinnedUrl: string | null
}

export interface TabsSnapshot {
  tabs: Record<string, TabInfo>
  order: string[]
  pinned: string[]
  activeId: string | null
}

export interface HistoryEntry {
  url: string
  title: string
  visitedAt: number
}

export interface Bookmark {
  url: string
  title: string
  createdAt: number
}

export interface DownloadInfo {
  id: string
  filename: string
  state: 'progressing' | 'completed' | 'failed'
  receivedBytes: number
  totalBytes: number
}

export interface SynapseApi {
  tabs: {
    create(url?: string): void
    close(id: string): void
    activate(id: string): void
    navigate(id: string, input: string): void
    back(id: string): void
    forward(id: string): void
    reload(id: string): void
    showContextMenu(id: string): void
  }
  onTabsUpdated(cb: (snap: TabsSnapshot) => void): void
  history: {
    search(q: string): Promise<HistoryEntry[]>
    list(): Promise<HistoryEntry[]>
  }
  bookmarks: {
    toggleActive(): Promise<void>
    list(): Promise<Bookmark[]>
  }
  downloads: {
    reveal(id: string): void
    onUpdated(cb: (list: DownloadInfo[]) => void): void
  }
  ui: {
    setOverlayHeight(px: number): void
    onFocusUrlBar(cb: () => void): void
    onToggleHistory(cb: () => void): void
    onToggleBookmarks(cb: () => void): void
  }
}
