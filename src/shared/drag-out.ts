// A dragend that lands outside the window's viewport means "tear this tab
// out into its own window". Anywhere inside the viewport — including over
// the page area, whose native view draws above the chrome document — is
// never a tear-out. Edges are inclusive: 0..w and 0..h count as inside.
export function droppedOutsideViewport(
  pt: { clientX: number; clientY: number },
  w: number,
  h: number,
): boolean {
  return pt.clientX < 0 || pt.clientY < 0 || pt.clientX > w || pt.clientY > h
}
