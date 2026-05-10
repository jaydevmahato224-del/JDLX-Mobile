import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App.jsx'
import './index.css'
import { useStore } from './store/useStore'

// Using a placeholder client ID for now. User must configure this later.
const GOOGLE_CLIENT_ID = "473832938691-0et3o47opidpim0k0ufau8tq1qtn4sc9.apps.googleusercontent.com"

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
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
