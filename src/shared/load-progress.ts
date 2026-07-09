// Faux load-progress curve for the topbar hairline (Electron exposes no real
// page-load percentage): jump to a 25% floor, decelerate asymptotically toward
// an 85% ceiling; the renderer snaps to 100% when the load actually finishes.

const FLOOR = 0.25
const CEILING = 0.85
const TAU_MS = 2500

// don't show the bar at all for loads faster than this — cache hits shouldn't flash
export const SHOW_DELAY_MS = 150
// fade-out duration after snapping to 100%
export const FINISH_FADE_MS = 250

export function progressAt(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs)
  return FLOOR + (CEILING - FLOOR) * (1 - Math.exp(-t / TAU_MS))
}
