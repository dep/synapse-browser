import { defineConfig } from 'electron-vite'

// electron-vite externalizes package.json `dependencies` by default in BOTH the
// main and preload builds. Main needs that (the extension libs resolve their own
// preload files at runtime via require.resolve), but the chrome preload is
// sandboxed and cannot require() node_modules at runtime — its extension import
// must be bundled in, hence the exclude.
export default defineConfig({
  main: {},
  preload: {
    build: { externalizeDeps: { exclude: ['electron-chrome-extensions'] } },
  },
  renderer: {},
})
