import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: {
        // Keep off by default to avoid dev blank-screen cache issues.
        // Enable only when you explicitly want to test installability in dev.
        enabled: process.env.PWA_DEV === '1',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      },
      manifest: {
        name: 'JDLX Warehouse Partner',
        short_name: 'JDLX Warehouse',
        description: 'Official Warehouse Partner Portal for JDLX Logistics',
        theme_color: '#863bff',
        background_color: '#0a0a0c',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        id: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      }
    })
  ],

  server: {
    port: 5175,
    strictPort: true,
  },
})
