import { loadSpinner } from './load-spinner'

// Favicon slot for a sidebar row. workMark draws the work-profile ring; a
// marked row keeps the slot visible (hollow ring) when the favicon is
// missing or fails, instead of hiding it.
export function rowIcon(
  favicon: string | null | undefined,
  isLoading: boolean,
  workMark: boolean,
): HTMLElement {
  if (isLoading) return loadSpinner()
  const img = document.createElement('img')
  img.className = 'favicon' + (workMark ? ' work-ring' : '')
  if (workMark) img.title = 'Work profile'
  img.onerror = () => {
    // dropping src clears the broken-image glyph so the ring stands alone
    img.removeAttribute('src')
    if (!workMark) img.style.visibility = 'hidden'
  }
  if (favicon) img.src = favicon
  else if (!workMark) img.style.visibility = 'hidden'
  return img
}
