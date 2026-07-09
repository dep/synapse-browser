import type { TabsSnapshot } from '../shared/ipc'
import { FINISH_FADE_MS, SHOW_DELAY_MS, progressAt } from '../shared/load-progress'

export interface LoadingBar {
  update(snap: TabsSnapshot): void
}

// Faux-progress hairline at the topbar's bottom edge. Driven purely by
// tabs:updated snapshots; reflects the ACTIVE tab only. Per-tab start times
// survive tab switches, so returning to a long-loading tab resumes the bar
// at that tab's elapsed position instead of restarting.
export function initLoadingBar(): LoadingBar {
  const el = document.getElementById('loading-bar') as HTMLDivElement
  const startedAt = new Map<string, number>() // tabId → performance.now() at load start
  let shownFor: string | null = null // tab the bar is currently animating for
  let raf = 0
  let fadeTimer: ReturnType<typeof setTimeout> | null = null

  function frame(): void {
    if (!shownFor) return
    const elapsed = performance.now() - (startedAt.get(shownFor) ?? 0)
    el.style.transform = `scaleX(${progressAt(elapsed)})`
    // the SHOW_DELAY_MS gate: instant loads finish before ever becoming visible
    el.classList.toggle('visible', elapsed > SHOW_DELAY_MS)
    raf = requestAnimationFrame(frame)
  }

  function reset(): void {
    cancelAnimationFrame(raf)
    if (fadeTimer) clearTimeout(fadeTimer)
    fadeTimer = null
    shownFor = null
    el.classList.remove('visible', 'finishing')
    el.style.transform = 'scaleX(0)'
  }

  // snap to 100% and fade out; only worth showing if the bar was visible
  function finish(): void {
    cancelAnimationFrame(raf)
    shownFor = null
    if (!el.classList.contains('visible')) {
      reset()
      return
    }
    el.classList.add('finishing')
    el.style.transform = 'scaleX(1)'
    if (fadeTimer) clearTimeout(fadeTimer)
    fadeTimer = setTimeout(reset, FINISH_FADE_MS + 100)
  }

  return {
    update(snap) {
      // book-keep load starts/ends for every tab, not just the active one
      for (const [id, tab] of Object.entries(snap.tabs)) {
        if (tab.isLoading) {
          if (!startedAt.has(id)) startedAt.set(id, performance.now())
        } else if (id !== shownFor) {
          startedAt.delete(id)
        }
      }
      for (const id of [...startedAt.keys()]) {
        if (!snap.tabs[id] && id !== shownFor) startedAt.delete(id) // closed mid-load
      }

      const active = snap.activeId ? snap.tabs[snap.activeId] : null
      if (active?.isLoading) {
        if (shownFor !== active.id) {
          if (fadeTimer) reset() // cancel a finishing fade from the previous tab
          shownFor = active.id
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(frame)
        }
      } else if (shownFor) {
        // bar's tab either finished loading or is no longer active; a
        // still-loading background tab keeps its timestamp for when we return
        const stillLoading = !!snap.tabs[shownFor]?.isLoading
        if (!stillLoading) startedAt.delete(shownFor)
        if (snap.activeId === shownFor && !stillLoading) finish()
        else reset()
      }
    },
  }
}
