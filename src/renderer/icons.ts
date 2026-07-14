// inline SVG nav icons: consistent 16px grid, 1.7 stroke, currentColor —
// the text glyphs (←, ⟳) render spindly and unevenly weighted on macOS
const svg = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const ICON_BACK = svg('<path d="M10 3 5 8l5 5"/>')
export const ICON_FORWARD = svg('<path d="M6 3l5 5-5 5"/>')
// geometry keeps the glyph's visual bbox centered on (8, 8) — the arrowhead
// adds height above the circle, so the circle center sits below 8 on purpose
export const ICON_RELOAD = svg(
  '<polyline points="12.3 2 12.3 5.4 8.9 5.4"/><path d="M12.3 5.4A5.4 5.4 0 1 0 13.3 9.8"/>',
)
export const ICON_STOP = svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>')
export const ICON_GLOBE = svg(
  '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2.3 6h11.4M2.3 10h11.4"/>',
)
