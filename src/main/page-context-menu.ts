// Electron-free menu logic for right-clicks inside web page views.
// Mirrors the tab-model/tab-manager split: pure decisions here, Electron
// wiring (Menu.popup, clipboard, webContents calls) in page-context-menu-host.ts.

export type PageMenuAction =
  | 'open-link'
  | 'open-link-new-tab'
  | 'bookmark-link'
  | 'copy-link-url'
  | 'copy-image'
  | 'copy-image-url'
  | 'download-image'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'back'
  | 'forward'
  | 'reload'

export type PageMenuItem =
  | { kind: 'separator' }
  | { kind: 'item'; label: string; action: PageMenuAction; enabled: boolean }

// structural subset of Electron.ContextMenuParams, so the host can pass the
// event params straight through without copying
export interface PageContextParams {
  linkURL: string
  linkText: string
  mediaType: string
  srcURL: string
  selectionText: string
  isEditable: boolean
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
}

export interface PageTabContext {
  canGoBack: boolean
  canGoForward: boolean
}

const HTTP_RE = /^https?:\/\//

function item(label: string, action: PageMenuAction, enabled = true): PageMenuItem {
  return { kind: 'item', label, action, enabled }
}

export function linkBookmarkTitle(params: PageContextParams): string {
  return params.linkText.trim() || params.linkURL
}

export function buildPageContextMenu(
  params: PageContextParams,
  ctx: PageTabContext,
): PageMenuItem[] {
  const sections: PageMenuItem[][] = []
  if (HTTP_RE.test(params.linkURL)) {
    sections.push([
      item('Open Link', 'open-link'),
      item('Open in a New Tab', 'open-link-new-tab'),
      { kind: 'separator' },
      item('Bookmark Link', 'bookmark-link'),
      item('Copy Link URL', 'copy-link-url'),
    ])
  }
  return sections.flatMap((s, i) =>
    i === 0 ? s : [{ kind: 'separator' } as PageMenuItem, ...s],
  )
}
