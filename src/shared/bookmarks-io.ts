import type { Bookmark, BookmarkFolder, BookmarksData, ProfileId } from './ipc'

// parse + validate an export file: { v: 1, folders, bookmarks }; invalid
// items are skipped, anything structurally wrong returns null
export function parseBookmarksExport(text: string): BookmarksData | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj['v'] !== 1 || !Array.isArray(obj['folders']) || !Array.isArray(obj['bookmarks'])) {
    return null
  }
  const folders: BookmarkFolder[] = []
  for (const f of obj['folders']) {
    if (f && typeof f === 'object' && typeof (f as BookmarkFolder).id === 'string' &&
        typeof (f as BookmarkFolder).name === 'string') {
      folders.push({ id: (f as BookmarkFolder).id, name: (f as BookmarkFolder).name })
    }
  }
  const bookmarks: Bookmark[] = []
  for (const b of obj['bookmarks']) {
    if (!b || typeof b !== 'object') continue
    const cand = b as Record<string, unknown>
    if (typeof cand['id'] !== 'string' || typeof cand['url'] !== 'string' ||
        typeof cand['title'] !== 'string') continue
    bookmarks.push({
      id: cand['id'],
      url: cand['url'],
      title: cand['title'],
      createdAt: typeof cand['createdAt'] === 'number' ? cand['createdAt'] : 0,
      ...(typeof cand['folderId'] === 'string' ? { folderId: cand['folderId'] } : {}),
      ...(cand['profile'] === 'work' ? { profile: 'work' as ProfileId } : {}),
    })
  }
  return { folders, bookmarks }
}

export interface ImportPlan {
  folders: string[]
  bookmarks: Array<{ url: string; title: string; profile: ProfileId; folderName: string | null }>
  skipped: number
}

// collision-proof key: JSON-encoding the tuple avoids ambiguity from raw
// delimiter concatenation (e.g. url "a.com|b" + folder "" colliding with
// url "a.com" + folder "b")
const dedupeKey = (url: string, folderName: string | null): string =>
  JSON.stringify([url, folderName ?? ''])

// folders are matched by name; bookmarks dedupe by (url, resolved target
// folder name) against both the existing data and earlier items in the same
// import — both sides must resolve folderId to folder NAME before keying,
// since different folder ids can share the same name
export function planImport(existing: BookmarksData, incoming: BookmarksData): ImportPlan {
  const incomingFolderName = new Map(incoming.folders.map((f) => [f.id, f.name]))
  const existingFolderName = new Map(existing.folders.map((f) => [f.id, f.name]))
  const existingNames = new Set(existing.folders.map((f) => f.name))

  const seen = new Set(
    existing.bookmarks.map((b) =>
      dedupeKey(b.url, (b.folderId && existingFolderName.get(b.folderId)) || null),
    ),
  )

  const folders: string[] = []
  const neededFolders = new Set<string>()
  const bookmarks: ImportPlan['bookmarks'] = []
  let skipped = 0

  for (const b of incoming.bookmarks) {
    const folderName = (b.folderId && incomingFolderName.get(b.folderId)) || null
    const key = dedupeKey(b.url, folderName)
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    if (folderName) neededFolders.add(folderName)
    bookmarks.push({
      url: b.url,
      title: b.title,
      profile: b.profile === 'work' ? 'work' : 'default',
      folderName,
    })
  }

  for (const name of neededFolders) {
    if (!existingNames.has(name)) folders.push(name)
  }

  return { folders, bookmarks, skipped }
}
