import { useCallback, useEffect, useState } from 'react'

// Permissions the JDLX Mobile app actually uses. Shown once on first run.
// None are strictly required — the app degrades gracefully without them — so
// the user can always continue past this screen.
const PERMISSIONS = [
  { key: 'notifications', emoji: '🔔', title: 'Notifications', desc: 'Order updates, delivery alerts & best offers' },
  { key: 'location', emoji: '📍', title: 'Location', desc: 'Auto-detect your address for faster delivery' },
  { key: 'camera', emoji: '📷', title: 'Camera', desc: 'Upload photos for reviews, complaints & reports' },
]

// Can this browser/device actually use the permission at all?
function isSupported(key) {
  if (key === 'notifications') return 'Notification' in window
  if (key === 'location') return !!navigator.geolocation
  if (key === 'camera') return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  return false
}

// Best-effort current status. 'unavailable' means the device/browser has no
// such capability (counts as satisfied). 'unknown' means the browser has no
// permission API for it (iOS) — resolved by an actual request attempt.
function getPermissionStatus(key) {
  return new Promise((resolve) => {
    if (!isSupported(key)) return resolve('unavailable')
    if (key === 'notifications') {
      const p = Notification.permission
      return resolve(p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default')
    }
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      navigator.permissions.query({ name: key })
        .then((res) => resolve(res.state))
        .catch(() => resolve('unknown'))
    } else {
      resolve('unknown')
    }
  })
}

// Ask the browser for ONE permission and return the OUTCOME ('granted' |
// 'denied' | 'unavailable'). The outcome is authoritative — a fresh query can
// be unreliable where the browser lacks a permissions API. IMPORTANT: each call
// must come from its own direct user click, or the browser silently refuses to
// show the prompt (location/camera need a fresh user gesture every time).
async function requestPermission(key) {
  if (!isSupported(key)) return 'unavailable'
  if (key === 'notifications') {
    try {
      const res = await Notification.requestPermission()
      return res === 'granted' ? 'granted' : 'denied'
    } catch {
      return 'denied'
    }
  }
  if (key === 'location') {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('denied'), 8000)
      navigator.geolocation.getCurrentPosition(
        () => { clearTimeout(timer); resolve('granted') },
        () => { clearTimeout(timer); resolve('denied') },
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
      )
    })
  }
  if (key === 'camera') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((t) => t.stop())
      return 'granted'
    } catch {
      return 'denied'
    }
  }
  return 'denied'
}

const STATUS_META = {
  granted: { label: 'Allowed', cls: 'text-emerald-700 bg-emerald-100 border-emerald-200', icon: '✓' },
  denied: { label: 'Blocked', cls: 'text-red-700 bg-red-100 border-red-200', icon: '✕' },
  default: { label: 'Not asked', cls: 'text-amber-700 bg-amber-100 border-amber-200', icon: '○' },
  prompt: { label: 'Not asked', cls: 'text-amber-700 bg-amber-100 border-amber-200', icon: '○' },
  unknown: { label: 'Not asked', cls: 'text-amber-700 bg-amber-100 border-amber-200', icon: '○' },
  unavailable: { label: 'Not available', cls: 'text-gray-500 bg-gray-200 border-gray-300', icon: '–' },
  checking: { label: 'Checking…', cls: 'text-gray-500 bg-gray-200 border-gray-300', icon: '…' },
}

export default function OnboardingPermissions({ onComplete }) {
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'checking']))
  )
  const [requestingKey, setRequestingKey] = useState(null)

  const refreshStatuses = useCallback(async () => {
    const entries = await Promise.all(
      PERMISSIONS.map(async (p) => [p.key, await getPermissionStatus(p.key)])
    )
    setStatuses((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
  }, [])

  useEffect(() => {
    refreshStatuses()
  }, [refreshStatuses])

  // A permission counts as satisfied when it is granted OR the device simply
  // has no such capability ('unavailable'). 'unknown' (iOS: no permissions API)
  // still needs a real Allow tap, so it does NOT count as satisfied.
  const allSatisfied = PERMISSIONS.every((p) => {
    const s = statuses[p.key]
    return s === 'granted' || s === 'unavailable'
  })

  // If every permission is already satisfied, skip this screen automatically.
  useEffect(() => {
    if (allSatisfied) {
      const t = setTimeout(onComplete, 400)
      return () => clearTimeout(t)
    }
  }, [allSatisfied, onComplete])

  // Request a SINGLE permission. Each invocation runs from its own click, so
  // the browser shows the prompt (no stale user-gesture problem) and the row's
  // status is set straight from the outcome.
  const handleRequest = async (key) => {
    if (requestingKey) return
    setRequestingKey(key)
    try {
      const outcome = await requestPermission(key)
      setStatuses((prev) => ({ ...prev, [key]: outcome }))
    } finally {
      setRequestingKey(null)
    }
  }

  const blocked = PERMISSIONS.some((p) => statuses[p.key] === 'denied')

  return (
    // Colors come from the app theme (var(--color-surface) etc. swap between
    // light and dark automatically via the .dark class on the app root).
    <div className="fixed inset-0 z-[10050] overflow-y-auto flex bg-gradient-to-b from-[var(--color-surface)] via-[var(--color-surface-container)] to-[var(--color-surface)] text-[var(--color-on-surface)]">
      <div className="m-auto w-full max-w-md flex flex-col items-center px-6 py-10">
        {/* Logo */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-3xl shadow-lg shadow-amber-500/20 mb-5">
          🛒
        </div>
        <h1 className="text-2xl font-black tracking-tight text-center">Set up JDLX Mobile</h1>
        <p className="text-sm text-[var(--color-on-surface-variant)] mt-2 text-center leading-relaxed">
          Allow these to unlock the full JDLX Mobile experience — order updates, faster delivery and more.
        </p>

        {/* Permission list */}
        <div className="w-full mt-8 space-y-3">
          {PERMISSIONS.map((p) => {
            const s = statuses[p.key]
            const meta = STATUS_META[s] || STATUS_META.unknown
            const supported = isSupported(p.key)
            const canAsk = supported && (s === 'default' || s === 'prompt' || s === 'unknown')
            const asking = requestingKey === p.key
            return (
              <div
                key={p.key}
                className="flex items-center gap-4 rounded-2xl px-4 py-3.5 bg-[var(--color-surface-card)] border border-[var(--color-surface-high)]"
              >
                <div className="w-11 h-11 shrink-0 rounded-xl bg-[var(--color-surface-container)] flex items-center justify-center text-xl">
                  {p.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{p.title}</div>
                  <div className="text-xs text-[var(--color-on-surface-variant)] mt-0.5 leading-snug">{p.desc}</div>
                  {s === 'denied' && supported && (
                    <div className="text-[10px] text-[var(--color-error)] mt-1 leading-snug">
                      Blocked by the browser — allow it from site settings. The app still works if you continue.
                    </div>
                  )}
                </div>
                {canAsk ? (
                  <button
                    onClick={() => handleRequest(p.key)}
                    disabled={!!requestingKey}
                    className="shrink-0 px-3.5 py-2 rounded-full bg-[var(--color-surface-container)] border border-[var(--color-surface-high)] text-xs font-bold text-[var(--color-on-surface)] hover:border-amber-500 hover:text-amber-600 transition-colors disabled:opacity-50"
                  >
                    {asking ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 border-2 border-[var(--color-on-surface-variant)] border-t-[var(--color-on-surface)] rounded-full animate-spin" />
                        Asking…
                      </span>
                    ) : 'Allow'}
                  </button>
                ) : (
                  <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${meta.cls}`}>
                    {meta.icon} {meta.label}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Guidance when something got blocked */}
        {blocked && (
          <p className="w-full mt-4 text-[11px] text-[var(--color-on-surface-variant)] text-center leading-relaxed">
            💡 You can re-enable a blocked permission anytime from the browser/phone site settings.
          </p>
        )}

        {/* Actions */}
        <div className="w-full mt-8 space-y-3">
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-[var(--color-on-primary)] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all active:scale-[0.98]"
          >
            {blocked ? 'Continue Anyway →' : allSatisfied ? 'All set ✓' : 'Continue →'}
          </button>
          {blocked && (
            <p className="text-center text-[11px] text-[var(--color-on-surface-variant)]">
              Permissions are optional — manage them anytime from site settings.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}