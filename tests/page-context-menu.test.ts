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

describe('image section', () => {
  it('shows copy / copy url / download for an image', () => {
    const items = buildPageContextMenu(
      params({ mediaType: 'image', srcURL: 'https://example.com/cat.png' }),
      ctx,
    )
    expect(labels(items)).toEqual(['Copy Image', 'Copy Image URL', 'Download Image'])
    expect(actions(items)).toEqual(['copy-image', 'copy-image-url', 'download-image'])
  })

  it('shows the link section above the image section for a linked image', () => {
    const items = buildPageContextMenu(
      params({
        linkURL: 'https://example.com/a',
        mediaType: 'image',
        srcURL: 'https://example.com/cat.png',
      }),
      ctx,
    )
    expect(labels(items)).toEqual([
      'Open Link',
      'Open in a New Tab',
      '---',
      'Bookmark Link',
      'Copy Link URL',
      '---',
      'Copy Image',
      'Copy Image URL',
      'Download Image',
    ])
  })

  it('shows no image section when the image has no src url', () => {
    const items = buildPageContextMenu(params({ mediaType: 'image' }), ctx)
    expect(labels(items)).not.toContain('Copy Image')
  })
})

describe('edit and selection section', () => {
  it('shows Copy for a text selection', () => {
    const items = buildPageContextMenu(
      params({
        selectionText: 'hello',
        editFlags: { canCut: false, canCopy: true, canPaste: false },
      }),
      ctx,
    )
    expect(items).toEqual([{ kind: 'item', label: 'Copy', action: 'copy', enabled: true }])
  })

  it('shows no Copy for a whitespace-only selection', () => {
    const items = buildPageContextMenu(params({ selectionText: '   ' }), ctx)
    expect(labels(items)).not.toContain('Copy')
  })

  it('shows Cut/Copy/Paste in editable fields, enabled per editFlags', () => {
    const items = buildPageContextMenu(
      params({
        isEditable: true,
        editFlags: { canCut: false, canCopy: false, canPaste: true },
      }),
      ctx,
    )
    expect(items).toEqual([
      { kind: 'item', label: 'Cut', action: 'cut', enabled: false },
      { kind: 'item', label: 'Copy', action: 'copy', enabled: false },
      { kind: 'item', label: 'Paste', action: 'paste', enabled: true },
    ])
  })

  it('separates selection Copy from a link section', () => {
    const items = buildPageContextMenu(
      params({
        linkURL: 'https://example.com/a',
        selectionText: 'hello',
        editFlags: { canCut: false, canCopy: true, canPaste: false },
      }),
      ctx,
    )
    expect(labels(items)).toEqual([
      'Open Link',
      'Open in a New Tab',
      '---',
      'Bookmark Link',
      'Copy Link URL',
      '---',
      'Copy',
    ])
  })
})

describe('page fallback section', () => {
  it('shows Back/Forward/Reload when nothing else applies', () => {
    const items = buildPageContextMenu(params(), { canGoBack: true, canGoForward: false })
    expect(items).toEqual([
      { kind: 'item', label: 'Back', action: 'back', enabled: true },
      { kind: 'item', label: 'Forward', action: 'forward', enabled: false },
      { kind: 'item', label: 'Reload', action: 'reload', enabled: true },
    ])
  })

  it('does not appear when any other section rendered', () => {
    const items = buildPageContextMenu(params({ linkURL: 'https://example.com/a' }), {
      canGoBack: true,
      canGoForward: true,
    })
    expect(labels(items)).not.toContain('Back')
    expect(labels(items)).not.toContain('Reload')
  })
})
