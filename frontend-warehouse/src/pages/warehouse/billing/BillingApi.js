import { API_BASE_URL } from '../../../config'
import { apiFetch } from '../../../utils/apiFetch'

export async function billingFetch(path, options = {}) {
  const res = await apiFetch(`${API_BASE_URL}/warehouse/billing${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`)
  }
  return data
}

export const billingApi = {
  products: () => billingFetch('/products'),
  generate: (payload) => billingFetch('/generate', { method: 'POST', body: JSON.stringify(payload) }),
  history: ({ q = '', from = '', to = '', payment = '', limit = 200 } = {}) => {
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    if (payment) qs.set('payment', payment)
    if (limit) qs.set('limit', String(limit))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return billingFetch(`/history${suffix}`)
  },
  returnItems: (payload) => billingFetch('/return', { method: 'POST', body: JSON.stringify(payload) }),
  cancel: (payload) => billingFetch('/cancel', { method: 'POST', body: JSON.stringify(payload) }),
  exchange: (payload) => billingFetch('/exchange', { method: 'POST', body: JSON.stringify(payload) }),
}

// Optional damage-proof image upload for a billing line item (multipart — no
// JSON content-type so the browser sets the boundary). Returns the saved URL.
export async function billingUploadDamageImage(file) {
  const form = new FormData()
  form.append('file', file)
  // apiFetch (not raw fetch): require_warehouse_staff_permission reads ONLY
  // the Bearer header — a cookie-only request 401'd here, so damage-proof
  // image upload never worked. apiFetch attaches the token and (after the
  // FormData hardening) does NOT force a JSON Content-Type, so the browser
  // still sets the multipart boundary automatically.
  const res = await apiFetch(`${API_BASE_URL}/warehouse/billing/damage-upload`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || data.message || `Upload failed (${res.status})`)
  }
  // success_response returns { success, data: { url }, message }
  return (data.data && data.data.url) || data.url || ''
}

// The DB stores created_at as IST wall-clock ("YYYY-MM-DD HH:MM:SS" — the
// system-wide convention: the orders table default is datetime('now','+5h','+30m')
// and offline bills are written via ist_now_str()). JavaScript treats
// space-separated strings as LOCAL time, so parse them AS IST (+05:30)
// explicitly — otherwise every bill showed a time 5:30 ahead and the 24h
// return window / day grouping drifted. ISO strings pass through unchanged.
export function parseDbDate(value) {
  if (!value) return null
  const normalized =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)
      ? value.replace(' ', 'T') + '+05:30'
      : value
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatBillDate(value) {
  const d = parseDbDate(value)
  if (!d) return value || ''
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
