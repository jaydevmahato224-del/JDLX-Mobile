import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// Firebase Web config — provided via Vite env vars (VITE_FIREBASE_*) so the
// same codebase works for local dev and production without hardcoding values.
// Set them in frontend-store/.env (or .env.local):
//   VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET /
//   MESSAGING_SENDER_ID / APP_ID / VAPID_KEY
// These are public client-side credentials (safe to embed in the bundle).
const env = import.meta.env || {};
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'YOUR_API_KEY',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'YOUR_AUTH_DOMAIN',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'YOUR_PROJECT_ID',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'YOUR_STORAGE_BUCKET',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_MESSAGING_SENDER_ID',
  appId: env.VITE_FIREBASE_APP_ID || 'YOUR_APP_ID'
};

// Public VAPID key from Firebase Console → Project settings → Cloud Messaging
// → Web Push certificates. Needed for every web push subscription.
const VAPID_KEY = env.VITE_FIREBASE_VAPID_KEY || 'YOUR_VAPID_KEY';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// True once real Firebase project credentials are configured. Until then the
// app runs exactly as before (no push attempts, no errors) — push simply stays
// disabled instead of failing with placeholder values.
export const isPushConfigured = () =>
  Boolean(firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('YOUR_'));

const messaging = (typeof window !== 'undefined' && isPushConfigured()) ? getMessaging(app) : null;

/**
 * Converts a base64 string to a Uint8Array.
 * Necessary for VAPID key conversion in some browser environments.
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String || base64String.includes('YOUR_')) return null;
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Registers the Firebase Messaging background service worker.
 *
 * The worker (generated at build/dev time from VITE_FIREBASE_* by
 * vite.firebase-sw.plugin.js) is what receives and shows notifications while
 * the app is closed. Explicit registration here is more reliable than relying
 * on getToken()'s implicit default-path lookup.
 */
async function ensureMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch (err) {
    console.warn('Failed to register FCM service worker:', err);
    return null;
  }
}

export const requestForToken = async () => {
  if (!messaging) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Notification permission not granted.');
      return null;
    }

    const vapidKey = urlBase64ToUint8Array(VAPID_KEY);
    if (!vapidKey) {
      console.warn('VITE_FIREBASE_VAPID_KEY is not set — cannot request a push token.');
      return null;
    }

    const swRegistration = await ensureMessagingServiceWorker();

    const currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swRegistration || undefined,
    });
    if (currentToken) {
      return currentToken;
    } else {
      console.log('No registration token available. Request permission to generate one.');
    }
  } catch (err) {
    console.log('An error occurred while retrieving token. ', err);
  }
  return null;
};

export const onMessageListener = () =>
  new Promise((resolve) => {
    if (!messaging) return;
    onMessage(messaging, (payload) => {
      resolve(payload);
    });
  });

export default app;
