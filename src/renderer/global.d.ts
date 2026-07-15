import type { SuggestionsOverlayApi, SynapseApi } from '../shared/ipc'

declare global {
  interface Window {
    synapse: SynapseApi // chrome document only
    suggestionsOverlay: SuggestionsOverlayApi // suggestions.html only
  }
}

export {}
