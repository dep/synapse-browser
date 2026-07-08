import { describe, expect, it } from 'vitest'
import {
  buildPageContextMenu,
  linkBookmarkTitle,
  type PageContextParams,
  type PageMenuItem,
} from '../src/main/page-context-menu'

// every field at its "nothing under the cursor" default; tests override what they need
function params(overrides: Partial<PageContextParams> = {}): PageContextParams {
  return {
    linkURL: '',
    linkText: '',
    mediaType: 'none',
    srcURL: '',
    selectionText: '',
    isEditable: false,
    editFlags: { canCut: false, canCopy: false, canPaste: false },
    ...overrides,
  }
}

const ctx = { canGoBack: false, canGoForward: false }

function labels(items: PageMenuItem[]): string[] {
  return items.map((i) => (i.kind === 'separator' ? '---' : i.label))
}

function actions(items: PageMenuItem[]): string[] {
  return items.flatMap((i) => (i.kind === 'item' ? [i.action] : []))
}

describe('link section', () => {
  it('shows the five link items for an http(s) link', () => {
    const items = buildPageContextMenu(params({ linkURL: 'https://example.com/a' }), ctx)
    expect(labels(items)).toEqual([
      'Open Link',
      'Open in a New Tab',
      '---',
      'Bookmark Link',
      'Copy Link URL',
    ])
  })

  it('maps link items to link actions', () => {
    const items = buildPageContextMenu(params({ linkURL: 'http://example.com/a' }), ctx)
    expect(actions(items)).toEqual([
      'open-link',
      'open-link-new-tab',
      'bookmark-link',
      'copy-link-url',
    ])
  })

  it('shows no link section for non-http(s) links', () => {
    for (const linkURL of ['mailto:x@example.com', 'javascript:void(0)', 'ftp://files.example']) {
      const items = buildPageContextMenu(params({ linkURL }), ctx)
      expect(labels(items)).not.toContain('Open Link')
    }
  })
})

describe('linkBookmarkTitle', () => {
  it('uses the trimmed link text', () => {
    const p = params({ linkURL: 'https://a.example', linkText: '  Cool Site  ' })
    expect(linkBookmarkTitle(p)).toBe('Cool Site')
  })

  it('falls back to the url when the text is blank', () => {
    const p = params({ linkURL: 'https://a.example', linkText: '  ' })
    expect(linkBookmarkTitle(p)).toBe('https://a.example')
  })
})
