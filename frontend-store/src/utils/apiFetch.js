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
  
  const userToken = localStorage.getItem('userToken') || localStorage.getItem('token')
  // Spread only works on plain objects — a `Headers` instance (as passed by
  // some callers) spreads into nothing and silently drops the headers.
  // Convert it to a plain object first so the merge below keeps every header.
  const extraHeaders =
    options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : options.headers
  // Never force a JSON Content-Type on a FormData body: it strips the multipart
  // boundary, so the server sees no files/form fields at all (this silently
  // broke every profile-image / complaint / refund / report upload). Let the
  // browser set the multipart Content-Type automatically in that case.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const defaultHeaders = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {}),
    ...(extraHeaders || {}),
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