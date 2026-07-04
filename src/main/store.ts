import * as fs from 'node:fs'
import * as path from 'node:path'

export class JsonStore<T> {
  private data: T
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private filePath: string,
    fallback: T,
    private debounceMs = 500,
  ) {
    this.data = this.load(fallback)
  }

  get(): T {
    return this.data
  }

  set(data: T): void {
    this.data = data
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }

  private load(fallback: T): T {
    try {
      if (!fs.existsSync(this.filePath)) return fallback
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as T
    } catch {
      try {
        fs.renameSync(this.filePath, `${this.filePath}.bad`)
      } catch {
        // If even the rename fails, fall through to the fallback.
      }
      return fallback
    }
  }
}
