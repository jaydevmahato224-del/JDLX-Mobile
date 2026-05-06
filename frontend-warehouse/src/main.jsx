import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

// Register PWA service worker in production only.
// In dev, service workers frequently cause blank screens / cache confusion.
const enableDevSw = import.meta.env.DEV && import.meta.env.VITE_PWA_DEV === '1'
if (import.meta.env.PROD || enableDevSw) {
  const updateSW = registerSW({
    onNeedRefresh() {
      if (confirm('New content available. Reload?')) {
        updateSW(true)
      }
    },
    onOfflineReady() {
      console.log('App ready to work offline')
    },
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
