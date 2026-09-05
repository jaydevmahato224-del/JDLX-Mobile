import { useCallback, useEffect, useState } from 'react'

// Permissions the JDLX Mobile app actually uses. Shown once on first run.
const PERMISSIONS = [
  { key: 'notifications', emoji: '🔔', title: 'Notifications', desc: 'Order updates, delivery alerts & best offers' },
  { key: 'location', emoji: '📍', title: 'Location', desc: 'Auto-detect your address for faster delivery' },
  { key: 'camera', emoji: '📷', title: 'Camera', desc: 'Upload photos for reviews, complaints & reports' },
]

// Best-effort status check. Falls back to 'unknown' when the browser does not
// expose a permission API for that capability (iOS Safari, etc.).
function getPermissionStatus(key) {
  return new Promise((resolve) => {
    if (key === 'notifications') {
      if (!('Notification' in window)) return resolve('denied')
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

// Ask the browser for one permission. Returns true when granted.
async function requestPermission(key) {
  if (key === 'notifications') {
    if (!('Notification' in window)) return false
    const res = await Notification.requestPermission()
    return res === 'granted'
  }
  if (key === 'location') {
    if (!navigator.geolocation) return false
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000)
      navigator.geolocation.getCurrentPosition(
        () => { clearTimeout(timer); resolve(true) },
        () => { clearTimeout(timer); resolve(false) },
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
      )
    })
  }
  if (key === 'camera') {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((t) => t.stop())
      return true
    } catch {
      return false
    }
  }
  return false
}

const STATUS_META = {
  granted: { label: 'Allowed', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: '✓' },
  denied: { label: 'Blocked', cls: 'text-red-600 bg-red-50 border-red-200', icon: '✕' },
  default: { label: 'Not asked', cls: 'text-amber-600 bg-amber-50 border-amber-200', icon: '○' },
  prompt: { label: 'Not asked', cls: 'text-amber-600 bg-amber-50 border-amber-200', icon: '○' },
  unknown: { label: 'Not asked', cls: 'text-amber-600 bg-amber-50 border-amber-200', icon: '○' },
  checking: { label: 'Checking…', cls: 'text-gray-500 bg-gray-100 border-gray-200', icon: '…' },
}

export default function OnboardingPermissions({ onComplete }) {
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'checking']))
  )
  const [requesting, setRequesting] = useState(false)

  const refreshStatuses = useCallback(async () => {
    const entries = await Promise.all(
      PERMISSIONS.map(async (p) => [p.key, await getPermissionStatus(p.key)])
    )
    setStatuses(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    refreshStatuses()
  }, [refreshStatuses])

  const allGranted = Object.values(statuses).every((s) => s === 'granted')

  // If every permission is already allowed, skip this screen automatically.
  useEffect(() => {
    if (allGranted) {
      const t = setTimeout(onComplete, 400)
      return () => clearTimeout(t)
    }
  }, [allGranted, onComplete])

  const handleAllowAll = async () => {
    if (requesting) return
    setRequesting(true)
    try {
      for (const p of PERMISSIONS) {
        if (statuses[p.key] === 'granted') continue
        await requestPermission(p.key)
      }
    } finally {
      await refreshStatuses()
      setRequesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10050] overflow-y-auto bg-gradient-to-b from-[#0b1220] via-[#101a30] to-[#0b1220] text-white">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 max-w-md mx-auto">
        {/* Logo */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-3xl shadow-lg shadow-amber-500/20 mb-5">
          🛒
        </div>
        <h1 className="text-2xl font-black tracking-tight text-center">Set up JDLX Mobile</h1>
        <p className="text-sm text-slate-400 mt-2 text-center leading-relaxed">
          These permissions help us deliver a faster, smoother shopping experience. App ko better banane ke liye allow karo.
        </p>

        {/* Permission list */}
        <div className="w-full mt-8 space-y-3">
          {PERMISSIONS.map((p) => {
            const meta = STATUS_META[statuses[p.key]] || STATUS_META.unknown
            return (
              <div key={p.key} className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5">
                <div className="w-11 h-11 shrink-0 rounded-xl bg-white/10 flex items-center justify-center text-xl">
                  {p.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{p.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5 leading-snug">{p.desc}</div>
                </div>
                <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${meta.cls}`}>
                  {meta.icon} {meta.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Actions */}
        <div className="w-full mt-8 space-y-3">
          <button
            onClick={handleAllowAll}
            disabled={requesting || allGranted}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-[#0b1220] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {requesting ? (
              <>
                <span className="h-4 w-4 border-2 border-[#0b1220]/30 border-t-[#0b1220] rounded-full animate-spin" />
                Requesting…
              </>
            ) : allGranted ? (
              'All permissions granted ✓'
            ) : (
              'Allow Permissions'
            )}
          </button>
          <button
            onClick={onComplete}
            className="w-full text-center text-xs font-semibold text-slate-400 py-2 hover:text-slate-200 transition-colors"
          >
            {allGranted ? '' : 'Skip for now — continue anyway'}
          </button>
        </div>
      </div>
    </div>
  )
}