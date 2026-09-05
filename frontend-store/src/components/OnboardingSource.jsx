import { useState } from 'react'
import { apiFetch } from '../utils/apiFetch'
import { useStore } from '../store/useStore'

const SOURCE_OPTIONS = [
  { key: 'friends', emoji: '👨‍👩‍👧‍👦', label: 'Friends & Family', desc: 'Recommended by someone I know' },
  { key: 'relatives', emoji: '👪', label: 'Relatives', desc: 'My family told me about it' },
  { key: 'social_media', emoji: '📱', label: 'Social Media', desc: 'Saw it on a social platform' },
  { key: 'other', emoji: '💡', label: 'Other', desc: 'Anywhere else' },
]

const SOCIAL_PLATFORMS = [
  { key: 'whatsapp', label: '💬 WhatsApp' },
  { key: 'instagram', label: '📸 Instagram' },
  { key: 'facebook', label: '👍 Facebook' },
  { key: 'youtube', label: '▶️ YouTube' },
]

export default function OnboardingSource({ onComplete }) {
  const user = useStore((s) => s.user)
  const [source, setSource] = useState(null)
  const [platform, setPlatform] = useState('')
  const [otherText, setOtherText] = useState('')
  const [saving, setSaving] = useState(false)

  const showPlatformPicker = source === 'social_media'
  const showOtherInput = source === 'other'

  const canContinue = showPlatformPicker
    ? !!platform
    : showOtherInput
      ? !!source
      : !!source

  const selectSource = (key) => {
    setSource(key)
    if (key !== 'social_media') setPlatform('')
  }

  const handleContinue = async () => {
    if (!canContinue || saving) return
    setSaving(true)

    const sessionId = localStorage.getItem('jdlx_session_id') || 'anon'
    const payload = {
      source,
      platform: showPlatformPicker ? platform : null,
      detail: showOtherInput ? otherText.trim() : null,
      session_id: sessionId,
      user_id: user?.id ?? null,
    }

    // Keep a local copy too (harmless; the backend is the source of truth).
    try { localStorage.setItem('jdlx_heard_from', JSON.stringify(payload)) } catch { /* ignore */ }

    // Fire-and-forget: never block the onboarding flow on the network.
    try {
      await apiFetch('/api/onboarding/source', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch { /* analytics must never break onboarding */ }
    setSaving(false)
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-[10050] overflow-y-auto flex bg-gradient-to-b from-[var(--color-surface)] via-[var(--color-surface-container)] to-[var(--color-surface)] text-[var(--color-on-surface)]">
      <div className="m-auto w-full max-w-md flex flex-col px-6 py-8">
        {/* Top bar: skip */}
        <div className="w-full flex justify-between items-center mb-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-on-surface-variant)]">
            Quick question
          </span>
          <button
            onClick={onComplete}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--color-surface-container)] border border-[var(--color-surface-high)] text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors"
          >
            Skip
          </button>
        </div>

        {/* Heading */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/20 mt-6 mb-5">
          📣
        </div>
        <h1 className="text-2xl font-black tracking-tight">Where did you hear about JDLX Mobile?</h1>
        <p className="text-sm text-[var(--color-on-surface-variant)] mt-2 leading-relaxed">
          It helps us understand how people find us — so we can serve more customers like you. Takes 5 seconds.
        </p>

        {/* Options */}
        <div className="w-full mt-7 space-y-3">
          {SOURCE_OPTIONS.map((opt) => {
            const selected = source === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => selectSource(opt.key)}
                className={`w-full flex items-center gap-4 rounded-2xl px-4 py-3.5 border transition-all text-left ${
                  selected
                    ? 'border-amber-500 bg-[var(--color-surface-card)] ring-2 ring-amber-500/30'
                    : 'border-[var(--color-surface-high)] bg-[var(--color-surface-card)] hover:border-amber-400/60'
                }`}
              >
                <span className="w-11 h-11 shrink-0 rounded-xl bg-[var(--color-surface-container)] flex items-center justify-center text-xl">
                  {opt.emoji}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-sm">{opt.label}</span>
                  <span className="block text-xs text-[var(--color-on-surface-variant)] mt-0.5">{opt.desc}</span>
                </span>
                <span
                  className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] font-black transition-all ${
                    selected
                      ? 'border-amber-500 bg-amber-500 text-[var(--color-on-primary)]'
                      : 'border-[var(--color-surface-high)] text-transparent'
                  }`}
                >
                  ✓
                </span>
              </button>
            )
          })}
        </div>

        {/* Social media platform dropdown */}
        {showPlatformPicker && (
          <div className="w-full mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <label className="text-xs font-black uppercase tracking-widest text-[var(--color-on-surface-variant)] block mb-2">
              Choose platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-2xl bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] px-4 py-3.5 text-sm font-semibold text-[var(--color-on-surface)] outline-none focus:border-amber-500 transition-all"
            >
              <option value="">Select a social platform…</option>
              {SOCIAL_PLATFORMS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Other free-text */}
        {showOtherInput && (
          <div className="w-full mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <label className="text-xs font-black uppercase tracking-widest text-[var(--color-on-surface-variant)] block mb-2">
              Tell us more (optional)
            </label>
            <input
              type="text"
              maxLength={120}
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="Type something — an app name, an ad, anything…"
              className="w-full rounded-2xl bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] px-4 py-3.5 text-sm font-medium text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)] placeholder:opacity-50 outline-none focus:border-amber-500 transition-all"
            />
          </div>
        )}

        {/* Actions */}
        <button
          onClick={handleContinue}
          disabled={!canContinue || saving}
          className="mt-8 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-[var(--color-on-primary)] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}