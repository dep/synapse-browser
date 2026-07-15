import { contextBridge, ipcRenderer } from 'electron'
import type { SuggestionsOverlayApi } from '../shared/ipc'

// the suggestions overlay renders page-controlled strings; it gets only
// what it needs, never the full SynapseApi
const api: SuggestionsOverlayApi = {
  onUpdate: (cb) => {
    ipcRenderer.on('sugg:render', (_e, p) => cb(p))
  },
  height: (px, gen) => ipcRenderer.send('sugg:height', px, gen),
  pick: (url) => ipcRenderer.send('sugg:pick', url),
}

contextBridge.exposeInMainWorld('suggestionsOverlay', api)
