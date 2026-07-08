// Sites (banks especially) block user agents carrying Electron or an unknown
// app token; stripping both leaves a string identical to real Chrome.
export function toChromeUserAgent(ua: string, appName: string, appVersion: string): string {
  // Chromium builds the UA token from the app name with spaces removed
  return ua
    .replace(`${appName}/${appVersion}`, '')
    .replace(`${appName.replace(/\s+/g, '')}/${appVersion}`, '')
    .replace(/Electron\/\S+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
