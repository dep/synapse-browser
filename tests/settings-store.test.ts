import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings-store'

describe('SettingsStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to empty key and the default model', () => {
    const store = new SettingsStore(dir)
    expect(store.aiApiKey()).toBe('')
    expect(store.aiModel()).toBe('claude-opus-4-8')
  })

  it('round-trips key and model through disk', () => {
    const store = new SettingsStore(dir)
    store.setAiApiKey('sk-ant-test123')
    store.setAiModel('claude-haiku-4-5')
    store.flush()
    const again = new SettingsStore(dir)
    expect(again.aiApiKey()).toBe('sk-ant-test123')
    expect(again.aiModel()).toBe('claude-haiku-4-5')
  })

  it('normalizes unknown models on write and read', () => {
    const store = new SettingsStore(dir)
    store.setAiModel('claude-sonnet-4-7')
    expect(store.aiModel()).toBe('claude-opus-4-8')
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ v: 1, aiApiKey: 42, aiModel: 'nope' }),
    )
    const again = new SettingsStore(dir)
    expect(again.aiApiKey()).toBe('')
    expect(again.aiModel()).toBe('claude-opus-4-8')
  })

  it('setting the model preserves the key and vice versa', () => {
    const store = new SettingsStore(dir)
    store.setAiApiKey('sk-key')
    store.setAiModel('claude-sonnet-5')
    store.flush()
    const again = new SettingsStore(dir)
    expect(again.aiApiKey()).toBe('sk-key')
    expect(again.aiModel()).toBe('claude-sonnet-5')
  })
})
