import { contextBridge, ipcRenderer } from 'electron'

// a pane close button's whole world: it can only ask main to close its pane;
// main resolves which pane from the sending webContents
contextBridge.exposeInMainWorld('paneOverlay', {
  close: () => ipcRenderer.send('pane:close'),
})
