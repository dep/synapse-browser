import * as path from 'node:path'
import type { ProfileRule } from '../shared/profile-routing'
import { sanitizeRules } from '../shared/profile-routing'
import { JsonStore } from './store'

interface ProfileRulesFile {
  v: 1
  rules: ProfileRule[]
}

export class ProfileRulesStore {
  private store: JsonStore<ProfileRulesFile>

  constructor(dir: string) {
    this.store = new JsonStore<ProfileRulesFile>(path.join(dir, 'profile-rules.json'), {
      v: 1,
      rules: [],
    })
  }

  list(): ProfileRule[] {
    return sanitizeRules(this.store.get().rules)
  }

  save(rules: unknown): void {
    this.store.set({ v: 1, rules: sanitizeRules(rules) })
  }

  flush(): void {
    this.store.flush()
  }
}
