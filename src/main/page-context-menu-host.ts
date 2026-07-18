import { clipboard, Menu } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { buildPageContextMenu, linkBookmarkTitle } from './page-context-menu'
import type { PageMenuAction } from './page-context-menu'

export interface PageMenuActions {
  openLinkInNewTab(url: string): void
  bookmarkLink(url: string, title: string): void
}

// pops the native right-click menu for a web page view; menu structure is
// decided by the Electron-free builder in page-context-menu.ts. Returns a
// disposer so a tab moving to another window can drop this window's menu.
export function attachPageContextMenu(
  wc: WebContents,
  win: BrowserWindow,
  actions: PageMenuActions,
): () => void {
  const handler = (_e: Electron.Event, p: Electron.ContextMenuParams): void => {
    const items = buildPageContextMenu(p, {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    })
    const run: Record<PageMenuAction, () => void> = {
      'open-link': () => wc.loadURL(p.linkURL),
      'open-link-new-tab': () => actions.openLinkInNewTab(p.linkURL),
      'bookmark-link': () => actions.bookmarkLink(p.linkURL, linkBookmarkTitle(p)),
      'copy-link-url': () => clipboard.writeText(p.linkURL),
      'copy-image': () => wc.copyImageAt(p.x, p.y),
      'copy-image-url': () => clipboard.writeText(p.srcURL),
      'download-image': () => wc.downloadURL(p.srcURL),
      cut: () => wc.cut(),
      copy: () => wc.copy(),
      paste: () => wc.paste(),
      back: () => wc.navigationHistory.goBack(),
      forward: () => wc.navigationHistory.goForward(),
      reload: () => wc.reload(),
    }
    Menu.buildFromTemplate(
      items.map((it) =>
        it.kind === 'separator'
          ? { type: 'separator' as const }
          : { label: it.label, enabled: it.enabled, click: run[it.action] },
      ),
    ).popup({ window: win })
  }
  wc.on('context-menu', handler)
  return () => {
    if (!wc.isDestroyed()) wc.removeListener('context-menu', handler)
  }
}
