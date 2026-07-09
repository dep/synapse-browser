import * as path from 'node:path'
import { AI_MODEL_DEFAULT, normalizeAiModel, type AiModelId } from '../shared/ai'
import { JsonStore } from './store'

interface SettingsFile {
  v: 1
  aiApiKey: string
  aiModel: string
}

export class SettingsStore {
  private store: JsonStore<SettingsFile>

  constructor(dir: string) {
    this.store = new JsonStore<SettingsFile>(path.join(dir, 'settings.json'), {
      v: 1,
      aiApiKey: '',
      aiModel: AI_MODEL_DEFAULT,
    })
  }

  aiApiKey(): string {
    const key = this.store.get().aiApiKey
    return typeof key === 'string' ? key : ''
  }

  // normalize on read too: the file is user-editable and may carry garbage
  aiModel(): AiModelId {
    return normalizeAiModel(this.store.get().aiModel)
  }

  setAiApiKey(key: string): void {
    this.store.set({ ...this.normalized(), aiApiKey: key })
  }

  setAiModel(model: string): void {
    this.store.set({ ...this.normalized(), aiModel: normalizeAiModel(model) })
  }

  flush(): void {
    this.store.flush()
  }

  private normalized(): SettingsFile {
    return { v: 1, aiApiKey: this.aiApiKey(), aiModel: this.aiModel() }
  }
}
