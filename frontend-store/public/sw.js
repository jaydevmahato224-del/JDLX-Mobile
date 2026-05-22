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
