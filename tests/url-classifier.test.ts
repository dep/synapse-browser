import { describe, expect, it } from 'vitest'
import { classifyInput } from '../src/shared/url-classifier'

describe('classifyInput', () => {
  it('passes through full URLs', () => {
    expect(classifyInput('https://example.com/a?b=c')).toBe('https://example.com/a?b=c')
    expect(classifyInput('http://example.com')).toBe('http://example.com')
    expect(classifyInput('file:///Users/dep/x.html')).toBe('file:///Users/dep/x.html')
    expect(classifyInput('about:blank')).toBe('about:blank')
  })

  it('prefixes https:// onto host-like input', () => {
    expect(classifyInput('example.com')).toBe('https://example.com')
    expect(classifyInput('news.ycombinator.com/item?id=1')).toBe('https://news.ycombinator.com/item?id=1')
    expect(classifyInput('example.com:8080/path')).toBe('https://example.com:8080/path')
  })

  it('uses http:// for localhost and loopback', () => {
    expect(classifyInput('localhost:3000')).toBe('http://localhost:3000')
    expect(classifyInput('127.0.0.1:8000/admin')).toBe('http://127.0.0.1:8000/admin')
  })

  it('sends everything else to Shortmarks', () => {
    expect(classifyInput('what is rust')).toBe('https://shortmarks.com/s.php?q=what%20is%20rust')
    expect(classifyInput('hello')).toBe('https://shortmarks.com/s.php?q=hello')
    expect(classifyInput('is example.com down')).toBe('https://shortmarks.com/s.php?q=is%20example.com%20down')
  })

  it('trims whitespace and treats empty as about:blank', () => {
    expect(classifyInput('  example.com  ')).toBe('https://example.com')
    expect(classifyInput('')).toBe('about:blank')
    expect(classifyInput('   ')).toBe('about:blank')
  })
})
