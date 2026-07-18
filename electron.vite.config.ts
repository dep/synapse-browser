import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

// electron-vite externalizes package.json `dependencies` by default in BOTH the
// main and preload builds. Main needs that (the extension libs resolve their own
// preload files at runtime via require.resolve), but the chrome preload is
// sandboxed and cannot require() node_modules at runtime — its extension import
// must be bundled in, hence the exclude.
export default defineConfig({
  main: {},
  // three preloads: the full chrome API and the minimal overlay ones
  // (suggestions dropdown, split-pane close buttons)
  preload: {
    build: {
      externalizeDeps: { exclude: ['electron-chrome-extensions'] },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          suggestions: resolve(__dirname, 'src/preload/suggestions.ts'),
          pane: resolve(__dirname, 'src/preload/pane.ts'),
        },
      },
    },
  },
  // three documents: the chrome UI and the overlay views
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          suggestions: resolve(__dirname, 'src/renderer/suggestions.html'),
          pane: resolve(__dirname, 'src/renderer/pane.html'),
        },
      },
    },
  },
})
