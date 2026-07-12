// geometry shared by main (positions the WebContentsView) and the chrome
// renderer (paints the matching frame behind it)
export const CANVAS_GAP = 8
export const CANVAS_RADIUS = 8

export interface CanvasInsets {
  topbar: number
  overlay: number
  sidebar: number
  ai: number
}

export function computeCanvasBounds(
  w: number,
  h: number,
  i: CanvasInsets,
): { x: number; y: number; width: number; height: number } {
  const x = i.sidebar + CANVAS_GAP
  const y = i.topbar + i.overlay + CANVAS_GAP
  return {
    x,
    y,
    width: Math.max(0, w - x - i.ai - CANVAS_GAP),
    height: Math.max(0, h - y - CANVAS_GAP),
  }
}
