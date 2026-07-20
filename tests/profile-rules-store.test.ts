import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProfileRulesStore } from '../src/main/profile-rules-store'

describe('ProfileRulesStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profilerules-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty with no saved file', () => {
    expect(new ProfileRulesStore(dir).list()).toEqual([])
  })

  it('round-trips rules across instances', () => {
    const store = new ProfileRulesStore(dir)
    const rules = [
      { id: '1', pattern: 'github.com', profile: 'work' as const },
      { id: '2', pattern: 'news.test', profile: 'default' as const },
    ]
    store.save(rules)
    store.flush()
    expect(new ProfileRulesStore(dir).list()).toEqual(rules)
  })

  it('sanitizes malformed rules from a hand-edited file', () => {
    fs.writeFileSync(
      path.join(dir, 'profile-rules.json'),
      JSON.stringify({
        v: 1,
        rules: [{ id: '1', pattern: 'ok.test', profile: 'bogus' }, { id: 2 }, 'junk'],
      }),
    )
    expect(new ProfileRulesStore(dir).list()).toEqual([
      { id: '1', pattern: 'ok.test', profile: 'default' },
    ])
  })
})
