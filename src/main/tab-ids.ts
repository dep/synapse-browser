// Process-wide tab id mint. Ids must be unique across ALL windows' TabManagers
// so a tab can move between windows (drag-out) without colliding.
let counter = 0

export function nextTabId(): string {
  return `tab-${++counter}`
}
