import * as fs from 'node:fs'
import * as path from 'node:path'

export function uniquePath(
  dir: string,
  filename: string,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  let i = 1
  while (exists(candidate)) {
    candidate = path.join(dir, `${base} (${i++})${ext}`)
  }
  return candidate
}
