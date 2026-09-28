import { API_BASE_URL } from '../config'

// Mirrors the backend's JWT lifetime for admin tokens (8h). Used ONLY to drop
// a provably-expired Bearer snapshot from localStorage — an expired snapshot
// otherwise shadows the fresh HttpOnly auth cookie (the backend decodes
// header-first), so every call 401s and the "Extend Session" modal re-opens in
// a loop even after a successful re-auth.
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000
const MAX_SKEW_MS = 30 * 1000

function dropStaleAdminToken() {
  try {
    const saved = localStorage.getItem('adminTokenSavedAt')
    if (saved && Date.now() - Number(saved) > ADMIN_TOKEN_TTL_MS + MAX_SKEW_MS) {
      localStorage.removeItem('adminToken')
      localStorage.removeItem('admin_token')
      localStorage.removeItem('adminTokenSavedAt')
    }
  } catch {
    // storage unavailable — nothing to clean
  }
}

// Persist a fresh JWT as a Bearer snapshot after login / re-auth. The admin
// SPA is served cross-site (Vercel → Render), and browsers that block
// third-party cookies silently drop the Set-Cookie — without this snapshot
// every post-login call went out credential-less, 401'd, and re-opened the
// "Session Expired" modal in a loop. token_required accepts a Bearer header,
// so the snapshot carries the session even when cookies can't. The marker
// feeds dropStaleAdminToken's 8h TTL so a dead snapshot can never shadow a
// fresher cookie.
export function storeAdminTokenSnapshot(token) {
  if (!token) return
  try {
    localStorage.setItem('adminToken', token)
    localStorage.setItem('adminTokenSavedAt', String(Date.now()))
  } catch {
    // storage unavailable — cookie (if allowed) still works
  }
}

// Central 401 hook: fired once when the session cookie itself is dead, so the
// re-auth modal opens exactly once instead of once-per-background-poll.
let _onSessionExpired = null
export function setOnSessionExpired(handler) {
  _onSessionExpired = typeof handler === 'function' ? handler : null
}

export function markSessionRefreshed() {
  // Called after a successful login / re-auth. Refreshes the snapshot-age
  // marker so an in-flight token stays trusted for a full new TTL window.
  try {
    if (localStorage.getItem('adminToken') || localStorage.getItem('admin_token')) {
      localStorage.setItem('adminTokenSavedAt', String(Date.now()))
    }
  } catch {
    // storage unavailable
  }
  // Reset AdminRoute's module-level verify cache via the registered hook, so a
  // route change right after "Session extended" doesn't immediately 401-recheck
  // against the pre-extend cookie state and re-open the modal.
  try {
    if (typeof window !== 'undefined' && typeof window.__markAdminSessionVerified === 'function') {
      window.__markAdminSessionVerified()
    }
  } catch {
    // noop
  }
}

/**
 * Wrapper around fetch that automatically includes credentials (HttpOnly cookies)
 * and sets common headers. Use this instead of raw fetch for all API calls.
 */
export async function apiFetch(endpoint, options = {}) {
  let url
  if (endpoint.startsWith('http')) {
    url = endpoint
  } else {
    // Guard against double `/api/api/...`: API_BASE_URL already ends with
    // `/api`, so an endpoint that also starts with `/api/` must not be
    // prefixed again (this broke auth/OTP calls with a 404 + CORS error).
    const base = /\/api(\/|$)/.test(endpoint)
      ? API_BASE_URL.replace(/\/api\/?$/, '')
      : API_BASE_URL
    url = `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
  }

  // Role-scoped tokens: warehouse and admin sessions live in their own
  // localStorage keys. Tokens are now ENDPOINT-SCOPED so a warehouse tab in the
  // same browser can never attach an admin token to /warehouse/* calls (and
  // vice versa) — mismatched tokens made backend `role` checks 403/401 and
  // showed the session-expired modal on pages that were actually fine.
  const path = new URL(url, window.location.origin).pathname
  const isWarehouseEndpoint = path.includes('/api/warehouse') || path.includes('/api/partner')
  const adminToken = localStorage.getItem('adminToken') || localStorage.getItem('admin_token')
  const warehouseToken = localStorage.getItem('warehouseToken') || localStorage.getItem('warehouse_token')

  if (!isWarehouseEndpoint) dropStaleAdminToken()

  const activeToken = isWarehouseEndpoint ? warehouseToken : adminToken
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(activeToken ? { 'Authorization': `Bearer ${activeToken}` } : {}),
    ...options.headers,
  }

  // skipGlobalError is intentionally NOT stripped: fetch() itself ignores
  // unknown RequestInit fields, while the App.jsx window.fetch interceptor
  // reads it from the options object to skip the full-screen error takeover.
  const doFetch = (withAuthHeader) => {
    const headers = { ...defaultHeaders }
    if (!withAuthHeader) {
      // Retry variant: drop the Authorization header entirely so a VALID
      // HttpOnly cookie can answer instead of being shadowed by a stale
      // snapshot. (Setting it to `undefined` would send the literal string.)
      delete headers.Authorization
    }
    return fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    })
  }

  const hadAuthHeader = Boolean(defaultHeaders.Authorization)
  const httpMethod = (options.method || 'GET').toUpperCase()
  let res = await doFetch(true)

  if (res.status === 401 && hadAuthHeader && (httpMethod === 'GET' || httpMethod === 'HEAD')) {
    // A 401 with a Bearer attached has two possible causes: the token is
    // genuinely dead (modal time) OR the snapshot is stale while the cookie
    // is still valid (backend decodes header-first, so the bad header wins).
    // Retry once without the header before declaring the session dead —
    // this kills the last "modal opened although the session was fine" path.
    // GET/HEAD only: re-sending a mutation could double-run a handler whose
    // 401 came from a post-auth permission check, and the polling calls that
    // fed the modal loop are all GETs anyway.
    res = await doFetch(false)
  }

  // Central "session actually dead" signal. Only real 401s from
  // auth-guarded backend routes trigger it — never OPTIONS preflights or
  // pre-auth login endpoints, so the re-auth modal can't be opened by the
  // login page's own failed attempts (the previous loop path).
  if (res.status === 401 && _onSessionExpired && !res.url.includes('/login')) {
    try {
      _onSessionExpired(url)
    } catch {
      // handler errors must never break the caller's flow
    }
  }
  return res
}

/**
 * Helper to check if user is authenticated by calling verify-token endpoint
 */
export async function checkAuth() {
  try {
    const res = await apiFetch('/api/auth/verify-token')
    const data = await res.json()
    return data.valid ? data : null
  } catch {
    return null
  }
}

/**
 * Logout helper - calls backend logout and clears local state
 */
export async function apiLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // Ignore errors - cookie will be cleared anyway
  }
}
