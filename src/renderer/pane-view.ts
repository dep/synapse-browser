// the pane close button document: one button, one message
declare global {
  interface Window {
    paneOverlay: { close(): void }
  }
}

document.getElementById('close')!.addEventListener('click', () => window.paneOverlay.close())

export {}
