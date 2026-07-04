import { describe, expect, it } from 'vitest'
import { uniquePath } from '../src/main/unique-path'

describe('uniquePath', () => {
  it('returns dir/filename when nothing exists', () => {
    expect(uniquePath('/dl', 'report.pdf', () => false)).toBe('/dl/report.pdf')
  })

  it('appends (1), (2)... until the name is free', () => {
    const taken = new Set(['/dl/report.pdf', '/dl/report (1).pdf'])
    expect(uniquePath('/dl', 'report.pdf', (p) => taken.has(p))).toBe('/dl/report (2).pdf')
  })

  it('handles names without extensions', () => {
    const taken = new Set(['/dl/README'])
    expect(uniquePath('/dl', 'README', (p) => taken.has(p))).toBe('/dl/README (1)')
  })
})
