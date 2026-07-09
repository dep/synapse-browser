import { dialog, systemPreferences } from 'electron'
import type { BrowserWindow, Session } from 'electron'
import { MediaKind, PermissionsStore, mediaRequestPlan } from './permissions-store'

// Media (mic/camera) requests prompt per origin and the answer persists;
// every other permission keeps Electron's default allow-all behavior.
// Safe under the repo's webRequest rule — permission handlers don't touch
// the request pipeline extensions depend on.
export function attachPermissionPrompts(
  sess: Session,
  win: BrowserWindow,
  store: PermissionsStore,
): void {
  sess.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const kinds =
      permission === 'media' && 'mediaTypes' in details ? toKinds(details.mediaTypes) : []
    if (kinds.length === 0) {
      callback(true) // not a device request (e.g. getDisplayMedia); previous behavior
      return
    }
    void decide(win, store, details.requestingUrl, kinds).then(callback)
  })
}

function toKinds(mediaTypes: ReadonlyArray<'video' | 'audio'> | undefined): MediaKind[] {
  const kinds: MediaKind[] = []
  if (mediaTypes?.includes('audio')) kinds.push('microphone')
  if (mediaTypes?.includes('video')) kinds.push('camera')
  return kinds
}

async function decide(
  win: BrowserWindow,
  store: PermissionsStore,
  requestingUrl: string,
  kinds: MediaKind[],
): Promise<boolean> {
  let origin: string
  try {
    origin = new URL(requestingUrl).origin
  } catch {
    return false
  }
  let plan = mediaRequestPlan(kinds, (k) => store.get(origin, k))
  if (plan === 'ask') {
    const device = kinds.join(' and ')
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Allow', 'Don’t Allow'],
      defaultId: 0,
      cancelId: 1,
      message: `Allow ${origin} to use your ${device}?`,
    })
    plan = response === 0 ? 'allow' : 'deny'
    for (const k of kinds) store.set(origin, k, plan)
  }
  if (plan === 'deny') return false
  return ensureSystemMediaAccess(kinds)
}

// macOS gates device access behind TCC regardless of what the page was
// granted; ask once per device kind (subsequent calls resolve instantly)
async function ensureSystemMediaAccess(kinds: MediaKind[]): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  let ok = true
  for (const kind of kinds) ok = (await systemPreferences.askForMediaAccess(kind)) && ok
  return ok
}
