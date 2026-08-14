// Pure Web Push (VAPID) service worker — no Firebase needed.
// The backend sends pushes via pywebpush; this worker receives them and shows
// the notification (even when the app/tab is closed).

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
