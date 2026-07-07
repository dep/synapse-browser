export type ProfileId = 'default' | 'work'

export interface PinSlot {
  url: string
  title: string
  favicon: string | null
  profile?: ProfileId
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
  anchorUrl: string | null
  profile: ProfileId
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

export interface BookmarkFolder {
  id: string
  name: string
}

export interface Bookmark {
  id: string
  url: string
  title: string
  createdAt: number
  folderId?: string // absent = top level
}

export interface BookmarksData {
  folders: BookmarkFolder[]
  bookmarks: Bookmark[]
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
    reorder(id: string, toIndex: number): void
    showContextMenu(id: string): void
  }
  onTabsUpdated(cb: (snap: TabsSnapshot) => void): void
  history: {
    search(q: string): Promise<HistoryEntry[]>
    list(): Promise<HistoryEntry[]>
  }
  bookmarks: {
    toggleActive(): Promise<void>
    list(): Promise<BookmarksData>
    open(id: string): void
    remove(id: string): void
    reorder(id: string, toIndex: number): void
    moveToFolder(id: string, folderId: string | null, toIndex?: number): void
    addFolder(name: string): void
    renameFolder(id: string, name: string): void
    removeFolder(id: string): void
    showContextMenu(kind: 'bookmark' | 'folder', id: string): void
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
    onBookmarksChanged(cb: () => void): void
    onEditFolder(cb: (folderId: string) => void): void
  }
}
