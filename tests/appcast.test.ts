import { describe, expect, it } from 'vitest'
import { compareVersions, parseAppcast, pickUpdate } from '../src/shared/appcast'

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Synapse Browser</title>
    <item>
      <title>Version 0.4.0</title>
      <pubDate>Wed, 08 Jul 2026 12:00:00 +0000</pubDate>
      <sparkle:version>0.4.0</sparkle:version>
      <sparkle:shortVersionString>0.4.0</sparkle:shortVersionString>
      <description><![CDATA[<ul><li>Big stuff</li></ul>]]></description>
      <enclosure
        url="https://github.com/dep/synapse-browser/releases/download/0.4.0/Synapse.Browser-0.4.0-universal.dmg"
        sparkle:edSignature="c2lnbmF0dXJl"
        length="12345"
        type="application/octet-stream" />
    </item>
    <item>
      <title>Version 0.3.1</title>
      <pubDate>Tue, 07 Jul 2026 12:00:00 +0000</pubDate>
      <sparkle:version>0.3.1</sparkle:version>
      <sparkle:shortVersionString>0.3.1</sparkle:shortVersionString>
      <enclosure url="https://example.com/0.3.1.dmg" sparkle:edSignature="b2xk" length="99" type="application/octet-stream" />
    </item>
    <item>
      <title>Broken — no enclosure</title>
      <sparkle:version>9.9.9</sparkle:version>
    </item>
  </channel>
</rss>`

describe('parseAppcast', () => {
  it('parses items with enclosures and skips malformed ones', () => {
    const items = parseAppcast(FEED)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      version: '0.4.0',
      shortVersion: '0.4.0',
      pubDate: 'Wed, 08 Jul 2026 12:00:00 +0000',
      notesHtml: '<ul><li>Big stuff</li></ul>',
      url: 'https://github.com/dep/synapse-browser/releases/download/0.4.0/Synapse.Browser-0.4.0-universal.dmg',
      edSignature: 'c2lnbmF0dXJl',
      length: 12345,
    })
    expect(items[1]?.notesHtml).toBeNull()
  })

  it('returns [] for non-feed input', () => {
    expect(parseAppcast('')).toEqual([])
    expect(parseAppcast('not xml at all')).toEqual([])
  })

  it('is not fooled by attribute names that end with a real attribute name', () => {
    const feed = `<rss><channel><item>
      <sparkle:version>1.0.0</sparkle:version>
      <enclosure sourceurl="https://wrong.example.com/evil.dmg" url="https://real.example.com/x.dmg" sparkle:edSignature="c2ln" length="5" type="application/octet-stream" />
    </item></channel></rss>`
    expect(parseAppcast(feed)[0]?.url).toBe('https://real.example.com/x.dmg')
  })

  it('tolerates whitespace between description and CDATA', () => {
    const feed = `<rss><channel><item>
      <sparkle:version>1.0.0</sparkle:version>
      <description>
        <![CDATA[<p>hi</p>]]>
      </description>
      <enclosure url="https://a.com/x.dmg" sparkle:edSignature="c2ln" length="5" type="application/octet-stream" />
    </item></channel></rss>`
    expect(parseAppcast(feed)[0]?.notesHtml).toBe('<p>hi</p>')
  })
})

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('0.3.1', '0.3.0')).toBe(1)
    expect(compareVersions('0.3.0', '0.3.1')).toBe(-1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('pickUpdate', () => {
  it('picks the newest item strictly newer than current', () => {
    const items = parseAppcast(FEED)
    expect(pickUpdate(items, '0.3.0')?.shortVersion).toBe('0.4.0')
    expect(pickUpdate(items, '0.3.1')?.shortVersion).toBe('0.4.0')
    expect(pickUpdate(items, '0.4.0')).toBeNull()
    expect(pickUpdate(items, '1.0.0')).toBeNull()
  })
})
