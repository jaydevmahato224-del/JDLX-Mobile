import { API_BASE_URL } from '../config'

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
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  return fetch(url, {
    ...options,
    headers: defaultHeaders,
    credentials: 'include',
  })
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