import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    open: false // Don't auto-open browser
  },
  build: {
    target: 'es2022', // Support top-level await
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        login: 'login.html',
        dashboard: 'dashboard.html',
        upload: 'upload.html',
        jobAnalyses: 'job-analyses.html',
        viewAnalysis: 'view-analysis.html'
      }
    }
  }
})
