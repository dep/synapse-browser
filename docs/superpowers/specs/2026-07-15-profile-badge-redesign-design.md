# Profile Badge Redesign

Date: 2026-07-15
Status: approved

## Problem

The Work-profile indicator is a floating 8px solid orange circle (`.profile-dot`)
appended to every work tab row, bookmark row, and folder row. In a sidebar where
most items are Work, the dot repeats on nearly every row — it carries no
information, sits awkwardly between titles/counts/close buttons, and is
redundant on children of folders already marked Work.

## Design

Replace the dot with two quieter marks that reuse existing visual vocabulary,
and stop marking items whose container already implies their profile.

### Behavior rules

- **Folder rows**: a Work folder tints its existing count badge orange
  (`color: var(--work)`, no weight/size change) and carries a
  "Work profile" tooltip. No new element.
- **Bookmarks inside a folder**: marked only when their effective profile
  differs from the folder's. Main hydrates bookmarks with the *effective*
  profile before sending snapshots (`src/main/bookmarks.ts` — explicit profile
  wins, else the folder's), and setting a child to "default" deletes its
  override, so children of a Work folder are always effectively Work. The only
  markable case is a Work bookmark inside a Default folder.
- **Loose bookmarks and plain tab rows**: Work → an orange ring around the
  favicon, the same language pins already use (`.pin.work` inset ring).
  Tooltip "Work profile" on the row.
- Delete the `.profile-dot` element and CSS everywhere. The active-row work
  wash (`.tab.active.work`, `.pin.active.work`) and the pin ring are unchanged.

### Visual spec

- Ring: `box-shadow: 0 0 0 1.5px var(--work)` on the icon slot with a small
  border-radius, matching the pin ring's weight so both read as one system.
- Missing/failed favicon on a work row: the ring still renders around the
  empty icon slot (a hollow ring is a legible mark). While a tab is loading,
  the spinner occupies the slot and the ring is absent for that moment.
- Folder count tint is color-only.

### Touchpoints

- `src/renderer/sidebar.ts` — tab rows: drop the dot, ring the favicon.
- `src/renderer/bookmarks-section.ts` — bookmark rows: drop the dot, mark only
  on profile-differs-from-folder; folder rows: drop the dot, tint the count.
- `src/renderer/style.css` — remove `.profile-dot`; add ring and count-tint
  rules.
- No main-process or IPC changes.

## Testing

All Electron-coupled renderer DOM → manual smoke per repo convention:
Default vs Work tab, Work folder with children (children unmarked), loose Work
bookmark, Work bookmark inside a Default folder, missing-favicon work row.
No new pure logic worth extracting for Vitest.
