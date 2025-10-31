import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    open: false // Don't auto-open browser
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
