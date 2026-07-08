import { describe, expect, it } from 'vitest'
import { toChromeUserAgent } from '../src/shared/user-agent'

const chromeUA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.36 Safari/537.36'

describe('toChromeUserAgent', () => {
  it('strips the Electron and app-name tokens', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) synapse-browser/0.2.0 Chrome/126.0.6478.36 Electron/43.0.0 Safari/537.36'
    expect(toChromeUserAgent(ua, 'synapse-browser', '0.2.0')).toBe(chromeUA)
  })

  it('strips the token Chromium builds from a spaced app name (spaces removed)', () => {
    // real Electron 43 output: productName "Synapse Browser" becomes "SynapseBrowser/0.2.0"
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) SynapseBrowser/0.2.0 Chrome/126.0.6478.36 Electron/43.0.0 Safari/537.36'
    expect(toChromeUserAgent(ua, 'Synapse Browser', '0.2.0')).toBe(chromeUA)
  })

  it('strips an app-name token that kept its spaces', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Synapse Browser/0.2.0 Chrome/126.0.6478.36 Electron/43.0.0 Safari/537.36'
    expect(toChromeUserAgent(ua, 'Synapse Browser', '0.2.0')).toBe(chromeUA)
  })

  it('leaves an already-clean Chrome UA unchanged', () => {
    expect(toChromeUserAgent(chromeUA, 'Synapse Browser', '0.2.0')).toBe(chromeUA)
  })
})
