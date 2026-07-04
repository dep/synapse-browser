import type { SynapseApi } from '../shared/ipc'

declare global {
  interface Window {
    synapse: SynapseApi
  }
}

export {}
