import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  // main runs from node_modules so the extension libs can resolve their own
  // preload files at runtime; the chrome preload bundles its imports because
  // sandboxed preloads can't require() external modules
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {},
  renderer: {},
})
