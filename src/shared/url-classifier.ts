const FULL_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i
const HOST_RE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[a-z0-9-]+)+)(:\d+)?(\/\S*)?$/i

export function classifyInput(raw: string): string {
  const input = raw.trim()
  if (!input) return 'about:blank'
  if (FULL_URL_RE.test(input) || input.startsWith('about:')) return input
  if (!input.includes(' ') && HOST_RE.test(input)) {
    const host = input.split(/[/:]/)[0].toLowerCase()
    const scheme = host === 'localhost' || host === '127.0.0.1' ? 'http' : 'https'
    return `${scheme}://${input}`
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`
}
