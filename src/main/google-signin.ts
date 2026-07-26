import { BrowserWindow, dialog, shell } from 'electron'
import type { ProfileId } from '../shared/ipc'
import type { TabManager } from './tab-manager'
import { sessionForProfile } from './tab-manager'
import { ChromeCookiesUnavailable, extractGoogleCookies } from './chrome-cookies'
import { toElectronCookie } from '../shared/google-cookies'

export interface GoogleImportResult {
  ok: boolean
  set: number
  failed: number
  error?: string
}

// Google's website sign-in rejects Synapse as a non-genuine browser (BotGuard;
// unspoofable from Electron — see the client-hint investigation). Instead the
// user signs in inside the system Chrome, which Google trusts, and we transplant
// the resulting session cookies into Synapse's session so its tabs are logged
// in. See docs/superpowers/specs/2026-07-22-google-signin-via-system-browser-design.md.

// The identifier step of the standard web sign-in flow.
const SIGNIN_URL =
  'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2F&flowName=GlifWebSignIn&flowEntry=ServiceLogin'

// Open the Google sign-in page in the OS default browser.
function openSystemSignIn(): void {
  void shell.openExternal(SIGNIN_URL)
}

// Read the Google cookies from the system Chrome and set them on the target
// Synapse session. Never throws — extraction failures come back as
// { ok: false, error } so the caller can show a message.
async function importGoogleCookies(profile: ProfileId): Promise<GoogleImportResult> {
  let chromeCookies
  try {
    chromeCookies = extractGoogleCookies()
  } catch (e) {
    const error =
      e instanceof ChromeCookiesUnavailable
        ? e.message
        : `Could not read Chrome cookies: ${e instanceof Error ? e.message : String(e)}`
    return { ok: false, set: 0, failed: 0, error }
  }

  const target = sessionForProfile(profile)
  // the sets are independent; run them concurrently. A few analytics cookies
  // (odd domains/flags) can be rejected — the auth cookies that matter set
  // cleanly, so a failure is counted, not fatal.
  const results = await Promise.allSettled(chromeCookies.map((c) => target.cookies.set(toElectronCookie(c))))
  const set = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.length - set
  if (set === 0) {
    return { ok: false, set, failed, error: 'No Google cookies could be imported — sign in to Google in Chrome first.' }
  }
  return { ok: true, set, failed }
}

// Menu-driven end-to-end flow: open Google sign-in in the system browser, wait
// (via a native dialog) for the user to finish, import the cookies into the
// active tab's profile, reload the active tab, and report the outcome. Kept in
// main so no sandboxed web-tab UI or renderer state machine is needed.
export async function runGoogleSignInFlow(win: BrowserWindow, tabs: TabManager): Promise<void> {
  openSystemSignIn()
  const prompt = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Sign in to Google',
    message: 'Finish signing in to Google in your browser',
    detail:
      'Google only allows sign-in from its own browser, so a browser window has opened for you. ' +
      'Once you are signed in there, click Import to bring that session into Synapse.',
    buttons: ['Import', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })
  if (prompt.response !== 0) return

  const activeId = tabs.activeId
  const result = await importGoogleCookies(activeId ? tabs.profileOf(activeId) : 'default')

  if (result.ok) {
    if (activeId) tabs.reload(activeId)
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Signed in to Google',
      message: 'Imported your Google session',
      detail: `Synapse is now signed in. Reload any Google tabs that were already open.${
        result.failed ? ` (${result.failed} non-essential cookies were skipped.)` : ''
      }`,
      buttons: ['OK'],
    })
  } else {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Could not import Google session',
      message: 'Import failed',
      detail: result.error ?? 'Unknown error.',
      buttons: ['OK'],
    })
  }
}
