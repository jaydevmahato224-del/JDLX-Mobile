import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initGlobalModalScrollLock } from './utils/modalScrollLock'

// Global UX rule: jab bhi koi full-screen popup/modal khule, background page
// completely block ho jata hai (scroll/touch/wheel) — interaction sirf popup
// me hota hai jab tak user use back/cross se band na kar de.
initGlobalModalScrollLock()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })

    if ('caches' in window) {
      caches.keys().then((cacheNames) => {
        cacheNames
          .filter((cacheName) => cacheName.startsWith('jdlx-cache'))
          .forEach((cacheName) => caches.delete(cacheName))
      })
    }
  })
}
