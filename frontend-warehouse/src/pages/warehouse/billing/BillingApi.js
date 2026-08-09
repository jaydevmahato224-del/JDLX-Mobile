import { API_BASE_URL } from '../../../config'

// Staff/billing-agent sessions store the token under these keys.
export function getBillingToken() {
  return (
    localStorage.getItem('warehouseToken') ||
    localStorage.getItem('warehouse_token') ||
    localStorage.getItem('staff_token')
  )
}

export async function billingFetch(path, options = {}) {
  const token = getBillingToken()
  const res = await fetch(`${API_BASE_URL}/warehouse/billing${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
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
  const token = getBillingToken()
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE_URL}/warehouse/billing/damage-upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || data.message || `Upload failed (${res.status})`)
  }
  // success_response returns { success, data: { url }, message }
  return (data.data && data.data.url) || data.url || ''
}

// The DB stores created_at as UTC ("YYYY-MM-DD HH:MM:SS", CURRENT_TIMESTAMP).
// JavaScript treats space-separated strings as LOCAL time, which would show
// UTC wall-clock as local — so parse those as UTC first. ISO strings pass
// through unchanged.
export function parseDbDate(value) {
  if (!value) return null
  const normalized =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)
      ? value.replace(' ', 'T') + 'Z'
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
