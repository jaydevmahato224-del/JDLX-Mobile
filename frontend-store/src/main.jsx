import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './styles/fpsOptimize.css'
import { initFrameRateDetection } from './hooks/useFrameRate'
import { initPerformanceManager } from './utils/performanceManager'
import initAppShellBehavior from './utils/appShell'
import { useStore } from './store/useStore'

// Initialize 60/90/120fps display rate detection and runtime performance optimizations
initFrameRateDetection();
initPerformanceManager();
// Native-app feel: block pinch / double-tap zoom so the UI never reflows like
// a browser page (complements the locked viewport meta in index.html).
initAppShellBehavior();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA Install Prompt Capture
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useStore.getState().setPwaInstallPrompt(e);
  console.log('PWA Install Prompt Captured in main.jsx');
});

window.addEventListener('appinstalled', () => {
  useStore.getState().clearPwaInstallPrompt();
  console.log('App Installed');
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered: ', registration);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}
