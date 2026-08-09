import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// The warehouse app no longer ships a PWA service worker (stale cached builds
// and blank screens for partners). Unregister any worker left behind by
// previous builds and clear its caches so everyone gets the fresh UI.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })

    if ('caches' in window) {
      caches.keys().then((cacheNames) => {
        cacheNames
          .filter((cacheName) => cacheName.startsWith('workbox') || cacheName.startsWith('jdlx'))
          .forEach((cacheName) => caches.delete(cacheName))
      })
    }
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
