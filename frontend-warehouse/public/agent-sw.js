/*
 * Add-Product Agent PWA service worker.
 *
 * Deliberately MINIMAL — this app is live-session bound (OTP shifts, countdown,
 * break sync): nothing business-critical may be served stale. Strategy:
 *   - navigation requests → network, falling back to the app shell only when
 *     the device is fully offline (so the installed app at least opens).
 *   - everything else → network only, never cached.
 * Scope is /warehouse/agent — the manager panel is untouched.
 */
const SHELL_CACHE = 'agent-shell-v1'
const SHELL_URL = '/warehouse/agent'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.add(SHELL_URL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // API mutations always hit the network
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // API calls are never cached — agent data must be live.
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    // Defense-in-depth (registration is already scope-narrowed): panel pages
    // outside the agent app must NEVER get the agent shell as fallback.
    if (!url.pathname.startsWith('/warehouse/agent')) return
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(SHELL_URL).then((hit) => hit || caches.match('/index.html'))
      )
    )
  }
  // Non-navigation GETs (icons, assets): plain network — no caching on purpose.
})
