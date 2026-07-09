import * as path from 'node:path'
import { JsonStore } from './store'

export type MediaKind = 'microphone' | 'camera'
export type MediaDecision = 'allow' | 'deny'

interface PermissionsFile {
  v: 1
  origins: Record<string, Partial<Record<MediaKind, MediaDecision>>>
}

// a persisted deny wins outright; anything undecided means prompt the user;
// only a full set of persisted allows grants silently
export function mediaRequestPlan(
  kinds: MediaKind[],
  get: (kind: MediaKind) => MediaDecision | undefined,
): MediaDecision | 'ask' {
  const decisions = kinds.map(get)
  if (decisions.includes('deny')) return 'deny'
  if (decisions.includes(undefined)) return 'ask'
  return 'allow'
}

// per-origin media (mic/camera) grants; answers to the permission prompt
// stick across runs, like a real browser
export class PermissionsStore {
  private store: JsonStore<PermissionsFile>

  constructor(dir: string) {
    this.store = new JsonStore<PermissionsFile>(path.join(dir, 'permissions.json'), {
      v: 1,
      origins: {},
    })
  }

  get(origin: string, kind: MediaKind): MediaDecision | undefined {
    return this.store.get().origins[origin]?.[kind]
  }

  set(origin: string, kind: MediaKind, decision: MediaDecision): void {
    const { origins } = this.store.get()
    this.store.set({
      v: 1,
      origins: { ...origins, [origin]: { ...origins[origin], [kind]: decision } },
    })
  }

  flush(): void {
    this.store.flush()
  }
}
