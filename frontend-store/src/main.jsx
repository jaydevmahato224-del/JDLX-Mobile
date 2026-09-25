import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './styles/fpsOptimize.css'
import { initFrameRateDetection } from './hooks/useFrameRate'
import { initPerformanceManager } from './utils/performanceManager'
import initAppShellBehavior from './utils/appShell'
import { initErrorReporter } from './utils/errorReporter'
import { useStore } from './store/useStore'
import { API_BASE_URL } from './config'
import { apiFetch } from './utils/apiFetch'

// Initialize 60/90/120fps display rate detection and runtime performance optimizations
initFrameRateDetection();
initPerformanceManager();
// Native-app feel: block pinch / double-tap zoom so the UI never reflows like
// a browser page (complements the locked viewport meta in index.html).
initAppShellBehavior();
// Client error telemetry: capture crashes + unhandled rejections for the admin
// Error Center. Fail-silent — can never affect app behaviour.
initErrorReporter();

// Session id for interaction/onboarding analytics (read by Home.jsx
// logInteraction and OnboardingSource). Previously nothing ever wrote this
// key, so every event was stored with session_id 'anon' and user-journey
// analytics merged all visitors into one fake session. Lazy per-tab id —
// analytics-only, never used for auth or business decisions.
try {
  if (!localStorage.getItem('jdlx_session_id')) {
    localStorage.setItem('jdlx_session_id', `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
  }
} catch { /* storage unavailable — callers already fall back to 'anon' */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA Install Prompt Capture
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useStore.getState().setPwaInstallPrompt(e);
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
    console.warn('App install report failed (will retry later):', err);
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
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failure is non-fatal (app still works without offline
      // support) — swallow quietly instead of logging in production.
    });
  });
}
