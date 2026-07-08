// minimal parser for Sparkle appcast feeds — tolerant of unknown tags,
// skips items without a usable enclosure
export interface AppcastItem {
  version: string
  shortVersion: string
  pubDate: string
  notesHtml: string | null
  url: string
  edSignature: string
  length: number
}

export function parseAppcast(xml: string): AppcastItem[] {
  const items: AppcastItem[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]!
    const enclosure = /<enclosure\b([\s\S]*?)\/>/.exec(block)?.[1]
    if (!enclosure) continue
    // anchored on leading whitespace so e.g. sourceurl= can never match url=
    const attr = (name: string): string | null =>
      new RegExp(`[\\s"']${name}="([^"]*)"`).exec(enclosure)?.[1] ?? null
    const tag = (name: string): string | null =>
      new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim() ?? null
    const url = attr('url')
    const edSignature = attr('sparkle:edSignature')
    const version = tag('sparkle:version')
    if (!url || !edSignature || !version) continue
    const cdata = /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/.exec(block)
    items.push({
      version,
      shortVersion: tag('sparkle:shortVersionString') ?? version,
      pubDate: tag('pubDate') ?? '',
      notesHtml: cdata?.[1]?.trim() ?? null,
      url,
      edSignature,
      length: Number(attr('length') ?? 0) || 0,
    })
  }
  return items
}

export function compareVersions(a: string, b: string): number {
  const as = a.split('.').map((n) => parseInt(n, 10) || 0)
  const bs = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = (as[i] ?? 0) - (bs[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export function pickUpdate(items: AppcastItem[], current: string): AppcastItem | null {
  let best: AppcastItem | null = null
  for (const item of items) {
    if (compareVersions(item.shortVersion, current) <= 0) continue
    if (!best || compareVersions(item.shortVersion, best.shortVersion) > 0) best = item
  }
  return best
}
