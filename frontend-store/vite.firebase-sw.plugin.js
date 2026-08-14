// Generates /firebase-messaging-sw.js with the Firebase config baked in from
// VITE_FIREBASE_* env vars — at build time (into dist/) and in dev (served by
// a middleware at the same path).
//
// Why a generated file? The Firebase Messaging service worker is loaded by the
// BROWSER as a plain JS file and CANNOT read import.meta.env, so the config has
// to be injected when the file is written/served. When VITE_FIREBASE_* is not
// set, the worker is not emitted at all — no broken placeholder worker is ever
// served (and push stays disabled, same as the current unconfigured behavior).
import { loadEnv } from 'vite';

const SW_TEMPLATE = (config) => `importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Firebase Web config injected at build/dev time from VITE_FIREBASE_* env vars.
const firebaseConfig = ${JSON.stringify(config, null, 2)};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Show a system notification while the app is closed / in the background.
messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(notification.title || 'JDLX Mobile', {
    body: notification.body || '',
    icon: '/logo192.png',
    badge: '/logo192.png',
    data: { url: data.url || '/' }
  });
});

// Tap the notification → open/focus the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
`;

function firebaseConfigFromEnv(env) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

function isConfigured(config) {
  return Boolean(config.apiKey && !String(config.apiKey).includes('YOUR_'));
}

export default function firebaseMessagingSw() {
  let resolvedConfig = null;

  return {
    name: 'jdlx-firebase-messaging-sw',
    enforce: 'pre',

    configResolved(config) {
      resolvedConfig = config;
    },

    // Build: emit the worker into dist/ so the production site serves it.
    generateBundle() {
      if (!resolvedConfig) return;
      const env = loadEnv(resolvedConfig.mode, resolvedConfig.root, '');
      const config = firebaseConfigFromEnv(env);
      if (!isConfigured(config)) {
        this.warn(
          '[firebase-messaging-sw] VITE_FIREBASE_* not set — skipping firebase-messaging-sw.js generation (push disabled).'
        );
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: 'firebase-messaging-sw.js',
        source: SW_TEMPLATE(config),
      });
    },

    // Dev: serve the generated worker at /firebase-messaging-sw.js so push can
    // be tested locally without a production build.
    //
    // NOTE: Vite calls the function returned by configureServer as a post-hook
    // with NO arguments (see server/index.ts: postHooks.forEach((fn) => fn())),
    // so we must use server.middlewares instead of a middlewares parameter.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0] === '/firebase-messaging-sw.js') {
          const env = loadEnv(server.config.mode, server.config.root, '');
          const config = firebaseConfigFromEnv(env);
          if (!isConfigured(config)) {
            res.statusCode = 404;
            res.end('firebase-messaging-sw.js not generated (VITE_FIREBASE_* not set)');
            return;
          }
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(SW_TEMPLATE(config));
          return;
        }
        next();
      });
    },
  };
}
