import { describe, expect, it } from 'vitest'
import { shouldSyncUrlbar } from '../src/renderer/topbar'

describe('shouldSyncUrlbar', () => {
  it('syncs when the tab URL changes even though element focus is latched on the bar', () => {
    // clicking a page never blurs the chrome document, so activeElement still
    // reports the urlbar when a link click navigates the tab — the committed
    // navigation must win over the stale focus signal
    expect(
      shouldSyncUrlbar({
        tabChanged: false,
        urlChanged: true,
        urlbarFocused: true,
        loadingStarted: false,
        value: 'http://example.com/old',
      }),
    ).toBe(true)
  })

  it('preserves a focused draft while the tab URL is unchanged', () => {
    expect(
      shouldSyncUrlbar({
        tabChanged: false,
        urlChanged: false,
        urlbarFocused: true,
        loadingStarted: false,
        value: 'draft search',
      }),
    ).toBe(false)
  })

  it('restores a blank focused URL bar when loading starts', () => {
    expect(
      shouldSyncUrlbar({
        tabChanged: false,
        urlChanged: false,
        urlbarFocused: true,
        loadingStarted: true,
        value: '',
      }),
    ).toBe(true)
  })

  it('treats whitespace-only input as blank when loading starts', () => {
    expect(
      shouldSyncUrlbar({
        tabChanged: false,
        urlChanged: false,
        urlbarFocused: true,
        loadingStarted: true,
        value: '   ',
      }),
    ).toBe(true)
  })

  it('preserves a non-empty focused draft when loading starts', () => {
    expect(
      shouldSyncUrlbar({
        tabChanged: false,
        urlChanged: false,
        urlbarFocused: true,
        loadingStarted: true,
        value: 'draft search',
      }),
    ).toBe(false)
  })

  it('preserves a blank focused URL bar during ordinary same-tab snapshots', () => {
    expect(
      shouldSyncUrlbar({
        tabChanged: false,
        urlChanged: false,
        urlbarFocused: true,
        loadingStarted: false,
        value: '',
      }),
    ).toBe(false)
  })

  it('syncs after a tab change or when the URL bar is not focused', () => {
    expect(
      shouldSyncUrlbar({
        tabChanged: true,
        urlChanged: false,
        urlbarFocused: true,
        loadingStarted: false,
        value: 'draft search',
      }),
    ).toBe(true)
    expect(
      shouldSyncUrlbar({
        tabChanged: false,
        urlChanged: false,
        urlbarFocused: false,
        loadingStarted: false,
        value: 'stale URL',
      }),
    ).toBe(true)
  })
})
