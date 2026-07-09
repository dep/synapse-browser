// Spinner for the favicon slot of a loading row. Rows are rebuilt on every
// snapshot, which would restart a CSS animation; seeding a negative delay
// from a shared clock keeps every spinner at a stable global phase.
const SPIN_PERIOD_MS = 800

export function loadSpinner(): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = 'load-spinner'
  el.style.animationDelay = `-${performance.now() % SPIN_PERIOD_MS}ms`
  return el
}
