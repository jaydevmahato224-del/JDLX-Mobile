import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from "react-hot-toast"
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
)

// ─── OAuth Callback Snapshot ────────────────────────────────────────────────
// The backend redirects to /login?token=...&user=... after Google sign-in.
// The token is a one-time credential, so it is stripped from the URL as early
// as possible — at module load, BEFORE React renders or analytics/GA fires —
// keeping it out of the address bar, browser history, and any Referer/GA
// page-view leak. The params are snapshotted first so the component below can
// still consume them after the URL has been cleaned.
const OAUTH_CALLBACK = (() => {
  try {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('token') && !params.has('user')) return null
    const snapshot = {
      ref: params.get('ref'),
      error: params.get('error'),
      token: params.get('token'),
      user: params.get('user'),
    }
    window.history.replaceState({}, document.title, window.location.pathname)
    return snapshot
  } catch {
    return null
  }
})()

function Login() {
    const [error, setError] = useState('')
    const navigate = useNavigate()
    const location = useLocation()
    const user = useStore((state) => state.user)
    const setUser = useStore((state) => state.setUser)

    // Auth-restore redirect guard.
    //
    // Flow: after the Google OAuth round-trip the backend redirects to
    // /login?token=...&user=...
    //
    // The intended destination is resolved once, deterministically:
    //   1. ProtectedRoute's back-bounce target (location.state?.from)
    //   2. Backend callback destination captured from the URL (?to= or
    //      ?ref= handling), if present
    //   3. Default: /profile
    const intendedTarget = useRef(location.state?.from?.pathname || '/profile')

    useEffect(() => {
        if (user) {
            navigate(intendedTarget.current, { replace: true })
        }
    }, [user, navigate])

    useEffect(() => {
        // Params were snapshotted and scrubbed from the URL at module load
        // (see OAUTH_CALLBACK above) — the token never lingers in the address
        // bar, so this effect only consumes the in-memory snapshot.
        if (!OAUTH_CALLBACK) return
        const { ref: refCode, error: errorParam, token: tokenParam, user: userParam } = OAUTH_CALLBACK
        if (refCode) {
            localStorage.setItem('jdlx_ref_code', refCode)
        }

        if (errorParam) {
            setError('Google login failed. Please try again.')
            return
        }

        if (tokenParam && userParam) {
            try {
                const userData = JSON.parse(decodeURIComponent(userParam))
                setUser(userData, tokenParam)
                toast.success('Successfully logged in!')
                navigate(intendedTarget.current, { replace: true })
            } catch (err) {
                console.error('Failed to parse user data from OAuth callback', err)
            }
        }
    }, [setUser, navigate])

    const handleGoogleLogin = () => {
        const origin = API_BASE_URL.replace(/\/api\/?$/, '')
        const frontendUrl = encodeURIComponent(window.location.origin)
        const refCode =
            new URLSearchParams(window.location.search).get('ref') ||
            localStorage.getItem('jdlx_ref_code') ||
            ''
        const refQuery = refCode ? `&ref=${encodeURIComponent(refCode)}` : ''
        window.location.href = `${origin}/login/google?flow=user&frontend_url=${frontendUrl}${refQuery}`
    }

    return (
        <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
            <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner">
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-on-surface)] tracking-tight">Welcome to JDLX Mobile</h1>
                    <p className="text-[var(--color-on-surface-variant)] text-sm mt-2">Sign in with your Google account to continue shopping.</p>
                </div>

                {error && (
                    <div className="w-full rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-left">
                        <p className="text-sm text-red-600">{error}</p>
                    </div>
                )}

                <div className="w-full mt-4 flex flex-col gap-3 items-center">
                    <button
                        onClick={handleGoogleLogin}
                        className="flex items-center justify-center gap-3 w-[320px] max-w-full bg-primary text-white rounded-full px-6 py-3 font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                        <GoogleIcon />
                        Continue with Google
                    </button>
                </div>

                <p className="text-xs text-gray-400 mt-4 leading-relaxed">
                    By continuing, you agree to our Terms of Service and Privacy Policy.
                </p>
            </div>
        </div>
    )
}

export default Login
