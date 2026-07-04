import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonStore } from '../src/main/store'

interface Data {
  v: 1
  items: string[]
}

const FALLBACK: Data = { v: 1, items: [] }

describe('JsonStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-'))
    file = path.join(dir, 'data.json')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns fallback when file is missing', () => {
    const store = new JsonStore<Data>(file, FALLBACK)
    expect(store.get()).toEqual(FALLBACK)
  })

  it('loads existing file contents', () => {
    fs.writeFileSync(file, JSON.stringify({ v: 1, items: ['x'] }))
    const store = new JsonStore<Data>(file, FALLBACK)
    expect(store.get().items).toEqual(['x'])
  })

  it('set() debounces the write', () => {
    const store = new JsonStore<Data>(file, FALLBACK, 500)
    store.set({ v: 1, items: ['a'] })
    expect(fs.existsSync(file)).toBe(false)
    vi.advanceTimersByTime(499)
    expect(fs.existsSync(file)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).items).toEqual(['a'])
  })

  it('coalesces rapid set() calls into one final write', () => {
    const store = new JsonStore<Data>(file, FALLBACK, 500)
    store.set({ v: 1, items: ['a'] })
    vi.advanceTimersByTime(400)
    store.set({ v: 1, items: ['a', 'b'] })
    vi.advanceTimersByTime(500)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).items).toEqual(['a', 'b'])
  })

  it('flush() writes immediately and creates parent directories', () => {
    const nested = path.join(dir, 'deep', 'nested', 'data.json')
    const store = new JsonStore<Data>(nested, FALLBACK)
    store.set({ v: 1, items: ['now'] })
    store.flush()
    expect(JSON.parse(fs.readFileSync(nested, 'utf8')).items).toEqual(['now'])
  })

  it('renames a corrupt file to .bad and uses the fallback', () => {
    fs.writeFileSync(file, '{not json!!')
    const store = new JsonStore<Data>(file, FALLBACK)
    expect(store.get()).toEqual(FALLBACK)
    expect(fs.existsSync(`${file}.bad`)).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
  })
})
