import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  esbuild: {
    // Production hygiene: drop chatty logging from the bundle while keeping
    // warn/error intact (they carry real failure diagnostics). `pure` marks
    // these calls side-effect-free so Rollup tree-shakes them — unlike
    // `drop: ['console']`, which would also strip console.warn/error.
    pure: ['console.log', 'console.debug', 'console.info'],
  },
})
