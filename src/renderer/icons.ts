// inline SVG nav icons: consistent 16px grid, 1.7 stroke, currentColor —
// the text glyphs (←, ⟳) render spindly and unevenly weighted on macOS
const svg = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const ICON_BACK = svg('<path d="M10 3 5 8l5 5"/>')
export const ICON_FORWARD = svg('<path d="M6 3l5 5-5 5"/>')
export const ICON_RELOAD = svg(
  '<polyline points="13.6 3.2 13.6 6.6 10.2 6.6"/><path d="M13.6 6.6A5.4 5.4 0 1 0 14.6 11"/>',
)
export const ICON_STOP = svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>')
