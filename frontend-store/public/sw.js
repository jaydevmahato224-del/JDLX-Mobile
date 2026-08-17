const CACHE_NAME = 'jdlx-cache-v2';
const APP_SHELL = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.ico',
    '/logo192.png',
    '/logo512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                const cachePromises = APP_SHELL.map((url) => {
                    return fetch(url)
                        .then((response) => {
                            if (response.ok) {
                                return cache.put(url, response);
                            }
                            throw new Error(`Response not OK for ${url}`);
                        })
                        .catch((err) => {
                            console.warn('Gracefully skipped caching on install:', url, err);
                        });
                });
                return Promise.all(cachePromises);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    const requestUrl = new URL(event.request.url);
    
    // Bypass service worker for API calls
    if (requestUrl.pathname.startsWith('/api/') || requestUrl.host.includes('onrender.com')) {
        return;
    }

    const acceptHeader = event.request.headers.get('accept') || '';
    const isNavigationRequest =
        event.request.mode === 'navigate' || 
        (event.request.method === 'GET' && acceptHeader.includes('text/html'));

    if (isNavigationRequest) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put('/index.html', responseClone).catch((err) => {
                                console.warn('Cache put index.html failed:', err);
                            });
                        });
                        return response;
                    }
                    return caches.match('/index.html');
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    if (requestUrl.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const networkResponse = fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone).catch((err) => {
                                console.warn('Cache put failed in fetch event:', err);
                            });
                        });
                    }
                    return response;
                })
                .catch(() => cachedResponse); // Fallback to cache on network failure

            return cachedResponse || networkResponse;
        })
    );
});

// ─── Push Notifications (VAPID) ────────────────────────────────────────────
// The push handlers live in the MAIN service worker so enabling push never
// replaces this worker. A separate push worker registered at the same scope
// would take over from sw.js — and with no fetch handler it would kill both
// PWA installability (Chrome requires a fetch handler) and offline caching.

self.addEventListener('push', (event) => {
  let title = 'JDLX Mobile';
  let options = {
    body: '',
    icon: '/logo192.png',
    badge: '/logo192.png',
    data: { url: '/' }
  };

  try {
    const payload = event.data ? event.data.json() : {};
    title = payload.title || title;
    options.body = payload.body || '';
    options.data = { url: payload.url || '/' };
  } catch (err) {
    // Payload wasn't JSON — show the raw text.
    options.body = event.data ? event.data.text() : '';
  }

  event.waitUntil(self.registration.showNotification(title, options));

  // Ping any open tabs so the app can show an in-app toast too.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({
          type: 'PUSH_RECEIVED',
          title,
          body: options.body,
          url: options.data.url
        });
      });
    })
  );
});

// Tap the notification → open/focus the app at the right page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.split('#')[0] !== new URL(targetUrl, self.location.origin).href) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
