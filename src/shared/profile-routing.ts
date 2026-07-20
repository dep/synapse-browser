import type { ProfileId } from './ipc'

// a profile auto-routing rule (issue #33): new tabs whose URL contains
// `pattern` open in `profile`. Matching is a plain case-insensitive
// substring test — predictable over clever — and the first match wins.
export interface ProfileRule {
  id: string
  pattern: string
  profile: ProfileId
}

export function routeProfile(rules: ProfileRule[], url: string): ProfileId | null {
  const u = url.toLowerCase()
  for (const rule of rules) {
    const p = rule.pattern.trim().toLowerCase()
    if (p && u.includes(p)) return rule.profile
  }
  return null
}

// shared by the store's load and the IPC save: whatever arrives, only
// well-formed rules survive (unknown profiles fall back to default)
export function sanitizeRules(raw: unknown): ProfileRule[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r): ProfileRule[] => {
    if (typeof r !== 'object' || r === null) return []
    const { id, pattern, profile } = r as { id?: unknown; pattern?: unknown; profile?: unknown }
    if (typeof id !== 'string' || typeof pattern !== 'string') return []
    return [{ id, pattern, profile: profile === 'work' ? 'work' : 'default' }]
  })
}
