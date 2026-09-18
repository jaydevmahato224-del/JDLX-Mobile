/**
 * Client error telemetry reporter (self-hosted, no third-party SDK).
 *
 * Captures storefront problems (crashes, unhandled rejections, failed API
 * batches) and ships them to the backend's client-error capture endpoint,
 * where they are fingerprinted and grouped for the admin Error Center.
 *
 * 100% additive — nothing here can change app behaviour:
 *  - Every public function is fail-silent: telemetry can never throw.
 *  - Batching: events queue in-session and flush at most once every
 *    FLUSH_INTERVAL_MS, plus on page hide (sendBeacon) so closing the tab
 *    still delivers the batch.
 *  - Payload caps: message/stack are truncated client-side to match the
 *    backend limits; each flush carries at most MAX_BATCH events.
 *  - Kill switches: `CLIENT_ERROR_CAPTURE=off` on the backend turns ingestion
 *    off globally; the client can also force on/off via the
 *    `jdlx_client_capture` localStorage flag. Capture is OFF by default in dev
 *    builds so local debugging stays quiet. All paths simply stop sending.
 */

import { API_BASE_URL } from '../config'

const FLUSH_INTERVAL_MS = 10000
const MAX_BATCH = 10
const MAX_QUEUE = 30 // oldest events are dropped beyond this (bounded memory)
const MAX_MESSAGE_LEN = 500 // must not exceed backend MAX_MESSAGE_LEN
const MAX_STACK_LEN = 2000 // must not exceed backend MAX_STACK_LEN
const MAX_PAGE_LEN = 300
const LS_CAPTURE_KEY = 'jdlx_client_capture'
const LS_SESSION_KEY = 'jdlx_error_session'

const IS_DEV = import.meta.env.DEV
/** Same error kind+message is reported at most this many times per session. */
const MAX_PER_KEY = 5
const reportedCounts = new Map()

let queue = []
let flushTimer = null
let sessionKey = null
let initialized = false

/**
 * Capture is ON by default in production builds and OFF in dev (keeps local
 * debugging quiet). The `jdlx_client_capture` localStorage flag overrides both:
 * 'on' forces capture even in dev (used by e2e tests), 'off' forces it off.
 */
function isDisabled() {
  try {
    const override = localStorage.getItem(LS_CAPTURE_KEY)
    if (override === 'off') return true
    if (override === 'on') return false
  } catch { /* storage unavailable — fall back to the build default */ }
  return IS_DEV
}

function getSessionKey() {
  if (sessionKey) return sessionKey
  try {
    sessionKey = localStorage.getItem(LS_SESSION_KEY)
    if (!sessionKey) {
      sessionKey = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(LS_SESSION_KEY, sessionKey)
    }
  } catch {
    sessionKey = 's_anon'
  }
  return sessionKey
}

function safeString(value, limit) {
  if (typeof value !== 'string') return ''
  return value.slice(0, limit)
}

/** Best-effort logged-in user id — never throws, never blocks. */
function currentUserId() {
  try {
    const rawUser = localStorage.getItem('user')
    if (rawUser) {
      const parsed = JSON.parse(rawUser)
      if (parsed && parsed.id != null) return String(parsed.id)
    }
  } catch { /* not JSON / missing — fall through to token check */ }
  return null // backend resolves the user from the bearer token anyway
}

function buildEvent(input) {
  const ev = input || {}
  const message = safeString(ev.message, MAX_MESSAGE_LEN)
  if (!message) return null
  return {
    kind: ['crash', 'unhandledrejection', 'api_failure', 'manual'].includes(ev.kind) ? ev.kind : 'crash',
    message,
    stack: safeString(ev.stack, MAX_STACK_LEN),
    page: safeString(ev.page || (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : ''), MAX_PAGE_LEN),
    session_id: getSessionKey(),
    app_version: safeString(ev.app_version || '', 32),
    severity: ['low', 'medium', 'high', 'critical'].includes(ev.severity) ? ev.severity : undefined,
    user_id: currentUserId(),
    context: ev.context && typeof ev.context === 'object' ? ev.context : undefined,
  }
}

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (!queue.length || isDisabled()) return
  const batch = queue.splice(0, MAX_BATCH)
  // If a burst left more than one batch queued, keep draining — without this
  // the remaining events would sit unsent until a new event or pagehide.
  if (queue.length) scheduleFlush()
  try {
    const body = JSON.stringify({ events: batch })
    // sendBeacon survives page unload; fall back to keepalive fetch.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(`${API_BASE_URL}/client-error`, blob)) return
    }
    fetch(`${API_BASE_URL}/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'include',
    }).catch(() => { /* telemetry is best-effort */ })
  } catch { /* never let telemetry break the app */ }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS)
}

/** Public API — capture one event. Never throws. */
export function reportClientError(input) {
  try {
    if (isDisabled()) return
    const event = buildEvent(input)
    if (!event) return
    // Local dedup: the same error firing in a loop is capped per session so a
    // runaway client cannot flood the queue/backend.
    const dedupKey = `${event.kind}|${event.message}`
    const count = (reportedCounts.get(dedupKey) || 0) + 1
    reportedCounts.set(dedupKey, count)
    if (count > MAX_PER_KEY) return
    queue.push(event)
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
    scheduleFlush()
  } catch { /* fail silent */ }
}

/**
 * Compatibility wrapper used by the fetch interceptor and the global error
 * overlay: report a user-facing API/global failure. `source` may be an
 * endpoint URL or a page path. Never reports the telemetry sink itself, so a
 * failing capture endpoint can never create a report loop.
 */
export function captureApiFailure(source, note) {
  try {
    if (typeof source === 'string' && source.includes('/client-error')) return
    reportClientError({
      kind: 'api_failure',
      message: `Frontend failure: ${safeString(note, 200)} @ ${safeString(source, 200)}`,
      context: { source: safeString(source, 300), note: safeString(note, 200) },
    })
  } catch { /* fail silent */ }
}

/** Force an immediate flush (e.g. ErrorBoundary before showing the fatal screen). */
export function flushClientErrors() {
  try { flush() } catch { /* fail silent */ }
}

/**
 * Install global capture: window.onerror, unhandledrejection, pagehide flush.
 * Safe to call once from main.jsx; subsequent calls are no-ops.
 */
export function initErrorReporter() {
  if (initialized) return
  initialized = true

  window.addEventListener('error', (event) => {
    // Resource-loading errors (script/img) have no error object — still useful.
    const message = event?.message
      || (event?.target && event?.target !== window
        ? `Resource load failed: ${(event.target.tagName || 'unknown').toLowerCase()}`
        : '')
    if (!message) return
    reportClientError({
      kind: 'crash',
      message,
      stack: event?.error?.stack || '',
      context: {
        filename: safeString(event?.filename, 200),
        lineno: event?.lineno,
        colno: event?.colno,
        offline: typeof navigator !== 'undefined' ? !navigator.onLine : undefined,
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason
    const message = typeof reason === 'string'
      ? reason
      : (reason?.message || `Unhandled promise rejection: ${safeString(String(reason ?? 'unknown'), 200)}`)
    reportClientError({
      kind: 'unhandledrejection',
      message,
      stack: reason?.stack || '',
      context: { offline: typeof navigator !== 'undefined' ? !navigator.onLine : undefined },
    })
  })

  // Deliver anything still queued when the tab is closed / backgrounded.
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
