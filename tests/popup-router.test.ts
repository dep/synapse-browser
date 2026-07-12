import { describe, expect, it } from 'vitest'
import { routeWindowOpen } from '../src/shared/popup-router'

describe('routeWindowOpen', () => {
  it('routes featured window.open popups (OAuth) to a real window', () => {
    // Firebase signInWithPopup / Google OAuth: window.open(url, name, 'width=…')
    expect(routeWindowOpen('https://accounts.google.com/o/oauth2/auth', 'new-window')).toBe(
      'popup',
    )
  })

  it('routes plain link targets to a foreground tab', () => {
    expect(routeWindowOpen('https://example.com', 'foreground-tab')).toBe('tab')
    expect(routeWindowOpen('https://example.com', 'default')).toBe('tab')
    expect(routeWindowOpen('https://example.com', 'other')).toBe('tab')
  })

  it('keeps cmd+click in a background tab', () => {
    expect(routeWindowOpen('https://example.com', 'background-tab')).toBe('background-tab')
  })

  it('denies non-http(s) schemes regardless of disposition', () => {
    expect(routeWindowOpen('javascript:alert(1)', 'new-window')).toBe('deny')
    expect(routeWindowOpen('about:blank', 'foreground-tab')).toBe('deny')
    expect(routeWindowOpen('file:///etc/passwd', 'new-window')).toBe('deny')
  })
})
