import { describe, expect, it } from 'vitest'
import { errorPageDataUrl, errorPageHtml } from '../src/main/error-page'

describe('error page', () => {
  it('includes the description and a retry link to the original url', () => {
    const html = errorPageHtml('ERR_NAME_NOT_RESOLVED', 'https://nope.example')
    expect(html).toContain('ERR_NAME_NOT_RESOLVED')
    expect(html).toContain('href="https://nope.example"')
  })

  it('escapes HTML in the description and url', () => {
    const html = errorPageHtml('<script>alert(1)</script>', 'https://x.com/?q="><img>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('"><img>')
    const single = errorPageHtml("it's ' broken", "https://x.com/?q='onmouseover='alert(1)")
    expect(single).not.toContain("'onmouseover='")
    expect(single).toContain('&#39;')
  })

  it('produces an encoded data: url', () => {
    const url = errorPageDataUrl('oops', 'https://a.com')
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url)).toContain('oops')
  })
})
