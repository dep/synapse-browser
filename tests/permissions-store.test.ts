import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PermissionsStore, mediaRequestPlan } from '../src/main/permissions-store'

describe('PermissionsStore', () => {
  let dir: string
  let store: PermissionsStore

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-'))
    store = new PermissionsStore(dir)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('unknown origins have no decision', () => {
    expect(store.get('https://a.com', 'microphone')).toBeUndefined()
  })

  it('stores decisions per origin and device kind', () => {
    store.set('https://a.com', 'microphone', 'allow')
    store.set('https://a.com', 'camera', 'deny')
    store.set('https://b.com', 'microphone', 'deny')
    expect(store.get('https://a.com', 'microphone')).toBe('allow')
    expect(store.get('https://a.com', 'camera')).toBe('deny')
    expect(store.get('https://b.com', 'microphone')).toBe('deny')
    expect(store.get('https://b.com', 'camera')).toBeUndefined()
  })

  it('overwrites an earlier decision', () => {
    store.set('https://a.com', 'microphone', 'deny')
    store.set('https://a.com', 'microphone', 'allow')
    expect(store.get('https://a.com', 'microphone')).toBe('allow')
  })

  it('persists via flush and reloads', () => {
    store.set('https://a.com', 'microphone', 'allow')
    store.flush()
    const reloaded = new PermissionsStore(dir)
    expect(reloaded.get('https://a.com', 'microphone')).toBe('allow')
  })
})

describe('mediaRequestPlan', () => {
  it('allows when every requested kind is already allowed', () => {
    expect(mediaRequestPlan(['microphone'], () => 'allow')).toBe('allow')
    expect(mediaRequestPlan(['microphone', 'camera'], () => 'allow')).toBe('allow')
  })

  it('denies when any requested kind is denied, even without asking', () => {
    expect(mediaRequestPlan(['microphone', 'camera'], (k) => (k === 'camera' ? 'deny' : 'allow'))).toBe('deny')
    expect(mediaRequestPlan(['microphone'], () => 'deny')).toBe('deny')
  })

  it('asks when any requested kind is undecided', () => {
    expect(mediaRequestPlan(['microphone'], () => undefined)).toBe('ask')
    expect(mediaRequestPlan(['microphone', 'camera'], (k) => (k === 'microphone' ? 'allow' : undefined))).toBe('ask')
  })
})
