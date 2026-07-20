// background-tab unloading (issue #35): after 4 idle hours a tab's view is
// destroyed to reclaim memory; the tab entry stays and the next activation
// reloads the page. The sweep runs every 5 minutes.
export const UNLOAD_AFTER_MS = 4 * 60 * 60 * 1000
export const UNLOAD_SWEEP_MS = 5 * 60 * 1000

export interface UnloadCandidate {
  id: string
  lastActiveAt: number
  isActive: boolean
  isVisible: boolean // attached to the window (active tab or split pane)
  isAudible: boolean // playing sound in the background stays loaded
  isLoading: boolean
}

export function staleTabs(
  candidates: UnloadCandidate[],
  now: number,
  after: number = UNLOAD_AFTER_MS,
): string[] {
  return candidates
    .filter((c) => !c.isActive && !c.isVisible && !c.isAudible && !c.isLoading)
    .filter((c) => now - c.lastActiveAt >= after)
    .map((c) => c.id)
}
