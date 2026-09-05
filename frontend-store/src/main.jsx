import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './styles/fpsOptimize.css'
import { initFrameRateDetection } from './hooks/useFrameRate'
import { initPerformanceManager } from './utils/performanceManager'
import initAppShellBehavior from './utils/appShell'
import { useStore } from './store/useStore'
import { API_BASE_URL } from './config'
import { apiFetch } from './utils/apiFetch'

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

// App-install tracking: records the logged-in user as "app installed" so the
// admin panel can email users who installed the app and later uninstalled
// (push can no longer reach them, but email still can).
const APP_INSTALLED_FLAG = 'jdlx_app_installed';

async function reportAppInstalled() {
  const { user } = useStore.getState();
  if (!user) return; // flushed automatically once the user logs in
  try {
    await apiFetch('/user/app-installed', { method: 'POST' });
    localStorage.removeItem(APP_INSTALLED_FLAG);
  } catch (err) {
    // Keep the flag so a later visit retries the report.
    console.log('App install report failed (will retry later):', err);
  }
}

window.addEventListener('appinstalled', () => {
  useStore.getState().clearPwaInstallPrompt();
  localStorage.setItem(APP_INSTALLED_FLAG, '1');
  reportAppInstalled();
});

// Flush a pending install report when the user logs in (they may have installed
// the app while logged out, or the earlier report failed).
useStore.subscribe((state, prev) => {
  if (state.user && !prev.user && localStorage.getItem(APP_INSTALLED_FLAG)) {
    reportAppInstalled();
  }
});
// Also catch the case where the user already exists at page load (page refresh
// right after installing while logged in).
if (typeof window !== 'undefined' && useStore.getState().user && localStorage.getItem(APP_INSTALLED_FLAG)) {
  reportAppInstalled();
}

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
