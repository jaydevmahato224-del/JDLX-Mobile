// Pure Web Push (VAPID) — no Firebase project needed.
//
// The browser subscribes to its push service using a VAPID public key, then
// sends the subscription (endpoint + p256dh/auth keys) to our backend, which
// delivers notifications with pywebpush using the matching VAPID private key.
//
// Setup:
//   1. Generate a keypair once (e.g. `npx web-push generate-vapid-keys`).
//   2. Public key → frontend-store/.env  VITE_VAPID_PUBLIC_KEY
//   3. Private key → backend/.env        VAPID_PRIVATE_KEY (+ VAPID_SUBJECT)
//
// Until VITE_VAPID_PUBLIC_KEY is set, every function here no-ops so the app
// runs exactly as before (in-app notifications keep working).

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();

// True once a real VAPID public key is configured.
export const isPushConfigured = () =>
  Boolean(VAPID_PUBLIC_KEY && !VAPID_PUBLIC_KEY.includes('YOUR_'));

/**
 * Converts a base64url string to a Uint8Array (required by pushManager.subscribe).
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
 * Ensures the service worker that handles pushes is registered.
 *
 * The push handlers live in the MAIN PWA service worker (public/sw.js), which
 * is already registered by main.jsx on load. Registering a separate worker
 * (push-sw.js) at the same scope "/" would REPLACE sw.js — and without a
 * fetch handler it would break PWA installability and offline caching. This
 * explicit registration just guarantees sw.js is active (idempotent when
 * main.jsx already registered it).
 */
async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('Failed to register push service worker:', err);
    return null;
  }
}

/**
 * Requests notification permission (if needed) and creates/returns the browser
 * push subscription as a plain object ready to POST to the backend.
 *
 * Returns null when push is not configured, permission is denied, or the
 * browser doesn't support push.
 */
export async function subscribeToPush() {
  if (!isPushConfigured()) return null;
  if (!('PushManager' in window) || !('Notification' in window)) return null;

  try {
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      console.log('Notification permission not granted.');
      return null;
    }

    const swRegistration = await ensureServiceWorker();
    if (!swRegistration) return null;

    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    if (!applicationServerKey) return null;

    let subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
    // { endpoint, expirationTime, keys: { p256dh, auth } }
    return subscription.toJSON();
  } catch (err) {
    console.log('An error occurred while subscribing to push. ', err);
    return null;
  }
}

/** Current notification permission: 'granted' | 'denied' | 'default'. */
export const getPushPermission = () =>
  ('Notification' in window) ? Notification.permission : 'unsupported';

export default null;
