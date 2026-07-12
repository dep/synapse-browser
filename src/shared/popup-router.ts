// window.open routing: featured popups (disposition 'new-window' — OAuth
// windows above all) must become REAL child windows. Reopening them as tabs
// severs window.opener and window.name, which breaks any popup flow that
// hands its result back via postMessage (Firebase signInWithPopup, Google
// Identity Services, most SSO providers).
export type PopupRoute = 'popup' | 'tab' | 'background-tab' | 'deny'

export function routeWindowOpen(url: string, disposition: string): PopupRoute {
  if (!/^https?:\/\//.test(url)) return 'deny'
  if (disposition === 'new-window') return 'popup'
  if (disposition === 'background-tab') return 'background-tab'
  return 'tab'
}
