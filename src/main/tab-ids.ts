// Process-wide tab id mint. Ids must be unique across ALL windows' TabManagers
// so a tab can move between windows (drag-out) without colliding.
let counter = 0

export function nextTabId(): string {
  return `tab-${++counter}`
}

// tab-group ids share the mint: unique across windows and never colliding
// with restored state (restore mints fresh ids rather than trusting disk)
export function nextGroupId(): string {
  return `group-${++counter}`
}
