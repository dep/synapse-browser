import type { AiChatMessage } from './ai'
import type { ProfileRule } from './profile-routing'
import type { PaneRect } from './split-layout'

export type ProfileId = 'default' | 'work'

// primary = the persistent launch window (pins, bookmarks, AI sidebar);
// secondary = an ephemeral Cmd+N / torn-out window showing only its own tabs
export type WindowRole = 'primary' | 'secondary'

export interface AiSettings {
  apiKey: string
  model: string
}

export interface PinSlot {
  url: string
  title: string
  favicon: string | null
  profile?: ProfileId
}

export interface TabInfo {
  id: string
  title: string
  // user-set name (double-click rename); title already reflects it — carried
  // separately so persistence can tell a custom name from a page title
  customTitle: string | null
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

// the 12 preset tab-group colors (issue #34); a group may also have none.
// Ids are stable store/IPC tokens — the renderer maps them to actual paint
export const GROUP_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'brown',
  'grey',
] as const
export type GroupColor = (typeof GROUP_COLORS)[number]

// a tab group: contiguous run of tab-list tabs under a named header.
// profile is the group's last-assigned container — joining a group never
// converts a tab; picking a profile in the group menu converts all members
export interface TabGroupInfo {
  id: string
  name: string
  profile: ProfileId
  color?: GroupColor
}

export interface TabsSnapshot {
  tabs: Record<string, TabInfo>
  order: string[]
  pinned: string[]
  bookmarkTabs: Record<string, string> // bookmarkId → tabId, awake only
  groups: Record<string, TabGroupInfo> // groupId → meta, members ≥ 1
  tabGroups: Record<string, string> // tabId → groupId, grouped tabs only
  activeId: string | null
  panes: string[] // split-pane tab ids in layout order; [] = no split
  role: WindowRole
}

export interface HistoryEntry {
  url: string
  title: string
  visitedAt: number
}

export interface TopSite {
  host: string
  url: string
}

export interface WeatherInfo {
  tempC: number
  code: number
  city: string
  useFahrenheit: boolean
}

export interface NewTabData {
  entries: HistoryEntry[] // full history, newest first
  topSites: TopSite[]
  favicons: Record<string, string> // host → favicon URL
  weather: WeatherInfo | null // cached only; newtab.weather() fetches fresh
}

export interface Suggestion {
  url: string
  title: string
  favicon: string | null
  isBookmark: boolean
  autocomplete: string | null // set only on row 0, when it can complete the typed text
}

// chrome → main → suggestions overlay; empty items = dropdown closed.
// anchor is the urlbar-wrap rect in window coordinates (the overlay is a
// native view, positioned by main).
export interface SuggestionsPayload {
  anchor: { x: number; y: number; width: number }
  items: Suggestion[]
  selected: number // -1 = none
  query: string
}

// main stamps each forwarded render with a generation; the overlay echoes it
// with its measured height so main can drop replies for superseded renders
export interface SuggestionsRender extends SuggestionsPayload {
  gen: number
}

// the overlay document's whole world — deliberately not SynapseApi
export interface SuggestionsOverlayApi {
  onUpdate(cb: (p: SuggestionsRender) => void): void
  height(px: number, gen: number): void
  pick(url: string): void
}

// user-facing language calls these "bookmark groups"; the folder name is
// historical and stays in code/store for compatibility
export interface BookmarkFolder {
  id: string
  name: string
  profile?: ProfileId // absent = default; members without their own profile inherit it
  color?: GroupColor // same 12-hue palette as tab groups (issue #34)
}

export interface Bookmark {
  id: string
  url: string
  title: string
  createdAt: number
  folderId?: string // absent = top level
  profile?: ProfileId // absent = default
  favicon?: string | null // captured while the bookmark's tab is awake
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

export interface ShortcutRow {
  id: string
  label: string
  accelerator: string
  default: string
  fixed: boolean
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
    // cmd-click on back (-1), reload (0), forward (+1): that entry's URL
    // opens in a new background tab instead of navigating this one
    openNavInNewTab(id: string, offset: -1 | 0 | 1): void
    stop(id: string): void
    // group is the drop destination's tab group: a groupId joins it, null
    // leaves any group, undefined keeps the current membership
    reorder(id: string, toIndex: number, group?: string | null): void
    // double-click rename in the sidebar; '' reverts to the page title
    rename(id: string, title: string): void
    // tear the tab out into its own window at the given screen point
    detach(id: string, screenX: number, screenY: number): void
    // ⌥-click: tile the tab next to the focused pane (vertical split)
    openInSplit(id: string): void
    // selection rides along when the row is part of a ⌘/⇧ multi-select
    // (issue #37); the menu then offers group-the-selection actions
    showContextMenu(id: string, selection?: string[]): void
  }
  groups: {
    // ＋ Group button: a fresh group around a fresh blank tab; resolves to
    // the new group's id so the renderer can open its rename editor
    create(): Promise<string>
    // drop a tab onto the middle of another: group them (or join the target's)
    createFromDrop(targetId: string, draggedId: string): void
    close(id: string): void // close every member tab, group goes with them
    ungroup(id: string): void // dissolve: members stay as loose tabs
    rename(id: string, name: string): void
    reorder(id: string, toIndex: number): void // move the whole block
    removeTab(tabId: string): void // pull one tab out of its group
    saveToBookmarks(id: string): void // group → bookmark folder of slots
    showContextMenu(id: string): void
  }
  onTabsUpdated(cb: (snap: TabsSnapshot) => void): void
  suggestions: {
    update(p: SuggestionsPayload): void // push dropdown state; empty items = close
    onPicked(cb: () => void): void // a row was clicked in the overlay
  }
  history: {
    search(q: string): Promise<Suggestion[]>
    list(): Promise<HistoryEntry[]>
  }
  newtab: {
    data(): Promise<NewTabData>
    weather(): Promise<WeatherInfo | null>
  }
  bookmarks: {
    toggleActive(): Promise<void>
    list(): Promise<BookmarksData>
    open(id: string): void
    remove(id: string): void
    rename(id: string, title: string): void
    reorder(id: string, toIndex: number): void
    moveToFolder(id: string, folderId: string | null, toIndex?: number): void
    createFromTab(tabId: string, folderId: string | null): void
    addFolder(name: string): void
    renameFolder(id: string, name: string): void
    removeFolder(id: string): void
    showContextMenu(kind: 'bookmark' | 'folder', id: string): void
  }
  downloads: {
    reveal(id: string): void
    onUpdated(cb: (list: DownloadInfo[]) => void): void
  }
  shortcuts: {
    list(): Promise<ShortcutRow[]>
    set(id: string, accelerator: string): Promise<{ ok: boolean; error?: string }>
    reset(id: string): Promise<void>
    resetAll(): Promise<void>
    setRecording(active: boolean): void
  }
  find: {
    start(text: string): void
    step(dir: 1 | -1): void
    stop(): void
  }
  settings: {
    get(): Promise<AiSettings>
    set(patch: Partial<AiSettings>): Promise<void>
    open(): void
  }
  // profile auto-routing rules (issue #33); save replaces the whole list —
  // the settings screen is the only writer and edits are atomic that way
  profileRules: {
    list(): Promise<ProfileRule[]>
    save(rules: ProfileRule[]): Promise<void>
  }
  ai: {
    send(messages: AiChatMessage[]): void
    stop(): void
    toggleSidebar(): void
    onDelta(cb: (text: string) => void): void
    onDone(cb: () => void): void
    onError(cb: (message: string) => void): void
  }
  ui: {
    setOverlayHeight(px: number): void
    startSidebarDrag(): void
    endSidebarDrag(): void
    startAiSidebarDrag(): void
    endAiSidebarDrag(): void
    onSidebarWidth(cb: (px: number) => void): void
    onSidebarVisible(cb: (visible: boolean) => void): void
    onAiSidebarWidth(cb: (px: number) => void): void
    onAiSidebarVisible(cb: (visible: boolean) => void): void
    onSettings(cb: (open: boolean) => void): void
    onFindOpen(cb: () => void): void
    onFindStep(cb: (dir: 1 | -1) => void): void
    onFindResult(cb: (r: { matches: number; active: number }) => void): void
    onFocusUrlBar(cb: () => void): void
    // split-pane rects in window coordinates, streamed on every relayout;
    // [] when no split is showing (drives the active-pane glow + new-tab cell)
    onPaneRects(cb: (rects: PaneRect[]) => void): void
    onToggleHistory(cb: () => void): void
    onBookmarksChanged(cb: () => void): void
    onEditFolder(cb: (folderId: string) => void): void
    onEditBookmark(cb: (bookmarkId: string) => void): void
    onEditGroup(cb: (groupId: string) => void): void
  }
}
