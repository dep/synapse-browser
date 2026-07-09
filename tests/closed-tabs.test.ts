import { describe, expect, it } from 'vitest'
import { ClosedTabsStack } from '../src/main/closed-tabs'

describe('ClosedTabsStack', () => {
  it('pops the most recently pushed entry first', () => {
    const stack = new ClosedTabsStack()
    stack.push({ url: 'https://a.com', profile: 'default', index: 0 })
    stack.push({ url: 'https://b.com', profile: 'work', index: 2 })
    expect(stack.pop()).toEqual({ url: 'https://b.com', profile: 'work', index: 2 })
    expect(stack.pop()).toEqual({ url: 'https://a.com', profile: 'default', index: 0 })
    expect(stack.pop()).toBeUndefined()
  })

  it('ignores non-http(s) urls (blank tabs, error pages)', () => {
    const stack = new ClosedTabsStack()
    stack.push({ url: '', profile: 'default', index: 0 })
    stack.push({ url: 'data:text/html,x', profile: 'default', index: 0 })
    stack.push({ url: 'about:blank', profile: 'default', index: 0 })
    expect(stack.pop()).toBeUndefined()
  })

  it('evicts the oldest entry past the cap', () => {
    const stack = new ClosedTabsStack(2)
    stack.push({ url: 'https://a.com', profile: 'default', index: 0 })
    stack.push({ url: 'https://b.com', profile: 'default', index: 1 })
    stack.push({ url: 'https://c.com', profile: 'default', index: 2 })
    expect(stack.pop()?.url).toBe('https://c.com')
    expect(stack.pop()?.url).toBe('https://b.com')
    expect(stack.pop()).toBeUndefined()
  })
})
