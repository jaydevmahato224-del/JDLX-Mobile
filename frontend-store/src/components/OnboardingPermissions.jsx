import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Permissions the JDLX Mobile app actually uses. Shown once on first run.
// None are strictly required — the app degrades gracefully without them — so
// the user can always continue past this flow.
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

// Permissions API query names differ from our UI keys (the geolocation
// permission is named 'geolocation', NOT 'location' — querying 'location'
// throws TypeError in Chrome and would wrongly surface as "Not asked").
const PERM_QUERY_NAME = { location: 'geolocation' }

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
      navigator.permissions.query({ name: PERM_QUERY_NAME[key] || key })
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
// show the prompt (location/camera need a fresh user gesture every time). The
// sequential card flow guarantees this: each Allow tap is a fresh gesture.
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

// Per-card result banner (shown right after the user's choice, before the next
// card slides up). 'skipped' is card-local only — it is never written into the
// permission statuses (the browser genuinely never asked).
const OUTCOME_META = {
  granted: { emoji: '✓', label: 'Allowed!', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  denied: { emoji: '✕', label: 'Blocked', cls: 'text-red-700 bg-red-50 border-red-200' },
  unavailable: { emoji: '–', label: 'Not available', cls: 'text-gray-600 bg-gray-50 border-gray-200' },
  skipped: { emoji: '⏭', label: 'Skipped', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
}

// Slide-up animation for each card + the sheet itself (self-contained, same
// pattern as OnboardingGuide's FLOAT_CSS).
const SHEET_CSS = `
@keyframes jdlx-sheet-up {
  from { transform: translateY(100%); opacity: 0.4; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes jdlx-card-in {
  from { transform: translateY(24px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
`

// Result banner hold before the next card slides up.
const RESULT_HOLD_MS = 1100

// ─── One askable permission card ─────────────────────────────────────────────
// Remounted per step via key={step}, so phase/outcome always start fresh
// without effect-based resets. The Allow handler runs from the direct click so
// the browser shows its native prompt (fresh user gesture per card).
function PermissionCard({ permission, step, total, onOutcome }) {
  const [phase, setPhase] = useState('deciding') // deciding | asking | result
  const [outcome, setOutcome] = useState(null)

  const handleAllow = async () => {
    if (phase !== 'deciding') return
    setPhase('asking')
    let result = 'denied'
    try { result = await requestPermission(permission.key) } catch { result = 'denied' }
    setOutcome(result)
    setPhase('result')
    onOutcome(permission.key, result)
  }

  // Reject — skip this permission without asking the browser (the status keeps
  // its truthful pre-ask value, e.g. 'default' → "Not asked" in the summary).
  const handleReject = () => {
    if (phase !== 'deciding') return
    setOutcome('skipped')
    setPhase('result')
    onOutcome(permission.key, 'skipped')
  }

  const outcomeMeta = outcome ? (OUTCOME_META[outcome] || OUTCOME_META.skipped) : null

  return (
    <div className="px-6 pt-4 pb-2" style={{ animation: `jdlx-card-in ${step === 0 ? 340 : 300}ms ease-out both` }}>
      {/* Progress */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[var(--color-on-surface-variant)] tracking-wide uppercase">
          Permission {step + 1} of {total}
        </span>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i < step
                  ? 'w-4 bg-emerald-500'
                  : i === step
                    ? 'w-6 bg-amber-500'
                    : 'w-1.5 bg-[var(--color-surface-high)]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Icon */}
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-3xl shadow-lg shadow-amber-500/20 mx-auto mt-5">
        {permission.emoji}
      </div>
      <h2 className="text-xl font-black tracking-tight text-center mt-3">{permission.title}</h2>
      <p className="text-sm text-[var(--color-on-surface-variant)] mt-1.5 text-center leading-relaxed">
        {permission.desc}
      </p>

      {/* Outcome banner (after Allow/Reject) */}
      {phase === 'result' && outcomeMeta ? (
        <div className={`mt-5 flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${outcomeMeta.cls}`}>
          <span>{outcomeMeta.emoji}</span>
          <span>{outcomeMeta.label}</span>
          {outcome === 'denied' && (
            <span className="text-[11px] font-medium opacity-80">— allow it later from site settings</span>
          )}
        </div>
      ) : (
        /* Actions */
        <div className="mt-6 space-y-2.5">
          <button
            onClick={handleAllow}
            disabled={phase !== 'deciding'}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-[var(--color-on-primary)] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {phase === 'asking' ? (
              <>
                <span className="h-4 w-4 border-2 border-[var(--color-on-primary)]/40 border-t-[var(--color-on-primary)] rounded-full animate-spin" />
                Asking…
              </>
            ) : (
              <>Allow {permission.emoji}</>
            )}
          </button>
          <button
            onClick={handleReject}
            disabled={phase !== 'deciding'}
            className="w-full rounded-full px-6 py-3 text-sm font-bold text-[var(--color-on-surface-variant)] border border-[var(--color-surface-high)] hover:bg-[var(--color-surface-container)] transition-colors disabled:opacity-60"
          >
            Reject
          </button>
          <p className="text-center text-[10px] text-[var(--color-on-surface-variant)] pt-0.5">
            Optional — the app works fully either way.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Sequential bottom-sheet permission flow ─────────────────────────────────
// One card slides up at a time from the bottom of the (already visible) home
// page. Allow triggers the real browser prompt (fresh user gesture per card);
// Reject skips that permission. After the last card a summary card shows every
// permission's final status with a single Continue — completing the same
// one-time onboarding contract as before (onComplete + localStorage flag).
export default function OnboardingPermissions({ onComplete }) {
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'checking']))
  )
  const queue = useMemo(() => PERMISSIONS.filter((p) => isSupported(p.key)), [])
  const [stepIndex, setStepIndex] = useState(0)
  const advanceTimer = useRef(null)
  const completedRef = useRef(false)

  const refreshStatuses = useCallback(async () => {
    const entries = await Promise.all(
      PERMISSIONS.map(async (p) => [p.key, await getPermissionStatus(p.key)])
    )
    setStatuses((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
  }, [])

  useEffect(() => {
    // Deferred (not synchronous) so the initial permission query never causes
    // a cascading render during mount — the rule-correct way to load external
    // (browser permissions API) state into React.
    const t = setTimeout(refreshStatuses, 0)
    return () => clearTimeout(t)
  }, [refreshStatuses])

  // A permission counts as satisfied when it is granted OR the device simply
  // has no such capability ('unavailable'). 'unknown' (iOS: no permissions API)
  // still needs a real Allow tap, so it does NOT count as satisfied.
  const allSatisfied = PERMISSIONS.every((p) => {
    const s = statuses[p.key]
    return s === 'granted' || s === 'unavailable'
  })

  // If every permission is already satisfied, skip the flow automatically.
  useEffect(() => {
    if (allSatisfied) {
      const t = setTimeout(() => {
        if (!completedRef.current) { completedRef.current = true; onComplete() }
      }, 400)
      return () => clearTimeout(t)
    }
  }, [allSatisfied, onComplete])

  // Derived (no state): the summary card shows once the askable queue ends.
  const done = queue.length === 0 || stepIndex >= queue.length
  const blocked = PERMISSIONS.some((p) => statuses[p.key] === 'denied')
  const grantedCount = PERMISSIONS.filter((p) => statuses[p.key] === 'granted').length

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }, [])

  // Card resolved → show its outcome briefly, then slide up the next card.
  const handleOutcome = (key, result) => {
    if (result !== 'skipped') {
      setStatuses((prev) => ({ ...prev, [key]: result }))
      refreshStatuses()
    }
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(() => setStepIndex((i) => i + 1), RESULT_HOLD_MS)
  }

  const handleComplete = () => {
    if (completedRef.current) return
    completedRef.current = true
    onComplete()
  }

  return (
    // Overlay sits above the home page (which stays visible behind the scrim —
    // this is a popup flow now, not a full-page takeover). Colors come from the
    // app theme (var(--color-surface) etc. swap between light/dark).
    <div className="fixed inset-0 z-[10050] flex flex-col justify-end">
      {/* Scrim — explicit choice required, so tapping it does nothing */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />

      {/* Bottom sheet */}
      <div
        className="relative w-full max-w-md mx-auto rounded-t-[28px] bg-[var(--color-surface)] border-t border-x border-[var(--color-surface-high)] shadow-2xl text-[var(--color-on-surface)]"
        style={{
          animation: 'jdlx-sheet-up 340ms ease-out both',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
        }}
      >
        <style>{SHEET_CSS}</style>

        {/* Drag handle */}
        <div className="w-10 h-1.5 rounded-full bg-[var(--color-surface-high)] mx-auto mt-3" />

        {!done && queue[stepIndex] ? (
          <PermissionCard
            key={stepIndex}
            permission={queue[stepIndex]}
            step={stepIndex}
            total={queue.length}
            onOutcome={handleOutcome}
          />
        ) : (
          /* Summary card — final status of every permission */
          <div className="px-6 pt-4 pb-2" style={{ animation: 'jdlx-card-in 300ms ease-out both' }}>
            <div className="flex items-center justify-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-lg">🛒</span>
              <h2 className="text-lg font-black tracking-tight">
                {grantedCount > 0 ? `You're all set — ${grantedCount} permission${grantedCount > 1 ? 's' : ''} on` : 'Setup done'}
              </h2>
            </div>

            <div className="w-full mt-5 space-y-2.5">
              {PERMISSIONS.map((p) => {
                const s = statuses[p.key]
                const meta = STATUS_META[s] || STATUS_META.unknown
                return (
                  <div
                    key={p.key}
                    className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-[var(--color-surface-card)] border border-[var(--color-surface-high)]"
                  >
                    <span className="text-xl">{p.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{p.title}</div>
                      <div className="text-[11px] text-[var(--color-on-surface-variant)] leading-snug">{p.desc}</div>
                    </div>
                    <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${meta.cls}`}>
                      {meta.icon} {meta.label}
                    </span>
                  </div>
                )
              })}
            </div>

            {blocked && (
              <p className="w-full mt-3 text-[11px] text-[var(--color-on-surface-variant)] text-center leading-relaxed">
                💡 You can re-enable a blocked permission anytime from the browser/phone site settings.
              </p>
            )}

            <button
              onClick={handleComplete}
              className="w-full mt-5 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-[var(--color-on-primary)] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all active:scale-[0.98]"
            >
              {blocked ? 'Continue Anyway →' : 'Start Shopping →'}
            </button>
            {blocked && (
              <p className="text-center text-[11px] text-[var(--color-on-surface-variant)] mt-2">
                Permissions are optional — manage them anytime from site settings.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
