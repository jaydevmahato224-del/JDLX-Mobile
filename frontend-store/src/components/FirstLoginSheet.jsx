import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { API_BASE_URL } from '../config'

// Google brand mark — same SVG as the regular Login page card.
const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
)

// Slide-up animation — same pattern as OnboardingPermissions' SHEET_CSS so the
// first-run login feels like the rest of the onboarding popups.
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

// ─── First-run login bottom sheet ────────────────────────────────────────────
// Presented ONCE, right after the first-run onboarding, to logged-out users.
// It is a gentler version of the login page: same Google OAuth entry point,
// plus a "Skip for now" escape so nobody gets stuck. Skipping only closes this
// sheet — the existing login page, ProtectedRoute bounces, and all auth logic
// remain exactly as before.
export default function FirstLoginSheet({ onSkip }) {
    const [busy, setBusy] = useState(false)
    const navigate = useNavigate()

    // Same OAuth entry point as Login.jsx's handleGoogleLogin (verbatim logic:
    // backend base, frontend_url echo, referral code passthrough).
    const handleGoogleLogin = () => {
        if (busy) return
        setBusy(true)
        const origin = API_BASE_URL.replace(/\/api\/?$/, '')
        const frontendUrl = encodeURIComponent(window.location.origin)
        const refCode =
            new URLSearchParams(window.location.search).get('ref') ||
            localStorage.getItem('jdlx_ref_code') ||
            ''
        const refQuery = refCode ? `&ref=${encodeURIComponent(refCode)}` : ''
        window.location.href = `${origin}/login/google?flow=user&frontend_url=${frontendUrl}${refQuery}`
    }

    // Skip = close the sheet and stay in the app as a guest. Guest browsing,
    // header login buttons and ProtectedRoute redirects all keep working; the
    // user can log in later from those (unchanged) entry points.
    const handleSkip = () => {
        toast.success('You can log in anytime from the header or at checkout.')
        if (onSkip) return onSkip()
        // Fallback when used standalone (no parent flow): land on home.
        navigate('/', { replace: true })
    }

    return (
        <div className="fixed inset-0 z-[10050] flex flex-col justify-end">
            {/* Scrim — explicit choice required, so tapping it does nothing */}
            <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />

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

                <div className="px-6 pt-4 pb-2" style={{ animation: 'jdlx-card-in 340ms ease-out both' }}>
                    {/* Icon */}
                    <div className="w-16 h-16 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mx-auto mt-2 shadow-lg shadow-primary/10">
                        <GoogleIcon />
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-center mt-3">
                        Welcome to JDLX Mobile
                    </h2>
                    <p className="text-sm text-[var(--color-on-surface-variant)] mt-1.5 text-center leading-relaxed">
                        Sign in with Google to sync your cart, wishlist &amp; orders across devices.
                    </p>

                    {/* Actions */}
                    <div className="mt-6 space-y-2.5">
                        <button
                            onClick={handleGoogleLogin}
                            disabled={busy}
                            className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-amber-500 to-amber-600 text-[var(--color-on-primary)] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all active:scale-[0.98] disabled:opacity-60"
                        >
                            {busy ? (
                                <>
                                    <span className="h-4 w-4 border-2 border-[var(--color-on-primary)]/40 border-t-[var(--color-on-primary)] rounded-full animate-spin" />
                                    Opening Google…
                                </>
                            ) : (
                                <>
                                    <GoogleIcon />
                                    Continue with Google
                                </>
                            )}
                        </button>
                        <button
                            onClick={handleSkip}
                            disabled={busy}
                            className="w-full rounded-full px-6 py-3 text-sm font-bold text-[var(--color-on-surface-variant)] border border-[var(--color-surface-high)] hover:bg-[var(--color-surface-container)] transition-colors disabled:opacity-60"
                        >
                            Skip for now
                        </button>
                        <p className="text-center text-[10px] text-[var(--color-on-surface-variant)] pt-0.5">
                            By continuing, you agree to our Terms of Service and Privacy Policy.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
