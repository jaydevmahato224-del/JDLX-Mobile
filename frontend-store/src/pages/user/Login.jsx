import { useEffect, useRef, useState } from 'react'
import toast from "react-hot-toast"
import { API_BASE_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'

// Security countdown: after every OTP send the resend button is locked for a
// cooldown window and the OTP validity is shown, so spam/brute-force retries
// are discouraged at the UI layer (the backend enforces its own limits too).
const RESEND_COOLDOWN_SECONDS = 60
const OTP_VALID_SECONDS = 600 // backend expires OTPs after 10 minutes

function useCountdown() {
  const [seconds, setSeconds] = useState(0)
  const timerRef = useRef(null)

  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const start = (secs) => {
    stop()
    setSeconds(secs)
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current)
          timerRef.current = null
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  useEffect(() => stop, [])
  return { seconds, start }
}

const formatClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
)

const BackButton = ({ onClick }) => (
    <button
        onClick={onClick}
        className="self-start flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
    >
        ← Back
    </button>
)

function Login() {
    const [mode, setMode] = useState('choice'); // choice | signup-email | signup-otp | link-required
    const [signupEmail, setSignupEmail] = useState('');
    const [signupOtp, setSignupOtp] = useState('');
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const resendCooldown = useCountdown();
    const otpExpiry = useCountdown();

    // Backend is the source of truth for cooldown/expiry (admin-configurable,
    // escalating on every resend). Sync the UI countdowns from the response.
    const applyOtpResponseInfo = (json) => {
        const info = json && json.data && typeof json.data === 'object' ? json.data : {};
        if (info.cooldown_seconds) resendCooldown.start(Math.min(Number(info.cooldown_seconds), 3600));
        if (info.expires_in) otpExpiry.start(Math.min(Number(info.expires_in), 3600));
    };

    // Existing Google link/login OTP state (from ?link_required=true redirect)
    const [linkEmail, setLinkEmail] = useState('');
    const [linkGoogleId, setLinkGoogleId] = useState('');
    const [linkOtp, setLinkOtp] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const refCode = params.get('ref');
        if (refCode) {
            localStorage.setItem('jdlx_ref_code', refCode);
        }

        // Handle auth error redirect from backend
        const error = params.get('error');
        if (error) {
            if (error === 'otp_email_failed') {
                // Backend could not send the OTP email (SMTP down / not configured).
                toast.error("We couldn't send the OTP email to this account. Please try again in a moment.");
            } else {
                toast.error("Google login failed. Please try again.");
            }
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // Handle link_required from Google OAuth — the backend now sends this
        // for EVERY existing account (OTP confirmed login), not just email links.
        const linkReq = params.get('link_required');
        if (linkReq === 'true') {
            setMode('link-required');
            setLinkEmail(params.get('email') || '');
            setLinkGoogleId(params.get('google_id') || '');
            // Security countdown starts as soon as the OTP screen appears.
            resendCooldown.start(RESEND_COOLDOWN_SECONDS);
            otpExpiry.start(OTP_VALID_SECONDS);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, []);

    // ─── Google OAuth (existing accounts / new Google signups) ───────────────
    const handleGoogleLogin = () => {
        const origin = API_BASE_URL.replace(/\/api\/?$/, '');
        const frontendUrl = encodeURIComponent(window.location.origin);
        // Carry the referral code (from a shared ?ref= link, or one already
        // captured earlier) into the Google OAuth flow so the backend can
        // apply it to the new account right after signup.
        const refCode = new URLSearchParams(window.location.search).get('ref') || localStorage.getItem('jdlx_ref_code') || '';
        const refQuery = refCode ? `&ref=${encodeURIComponent(refCode)}` : '';
        window.location.href = `${origin}/login/google?flow=user&frontend_url=${frontendUrl}${refQuery}`;
    };

    // ─── Email OTP signup (new user) ─────────────────────────────────────────
    const handleSendOtp = async (e) => {
        e.preventDefault();
        const email = signupEmail.trim().toLowerCase();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            toast.error('Please enter a valid email address');
            return;
        }
        setSending(true);
        try {
            const res = await apiFetch('/api/auth/email/send-otp', {
                method: 'POST',
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (res.ok) {
                setSignupEmail(email);
                setMode('signup-otp');
                // Security countdown starts on every OTP send (backend decides
                // the escalating wait — cooldown_seconds in the response).
                applyOtpResponseInfo(data);
                toast.success('OTP sent to your email ✉️');
            } else {
                // 429 cooldown: backend tells us exactly how long to wait.
                applyOtpResponseInfo(data);
                toast.error(data.error || 'Failed to send OTP. Please try again.');
            }
        } catch (err) {
            toast.error('Network error. Please try again.');
        } finally {
            setSending(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (signupOtp.length !== 6) {
            toast.error('Please enter the 6-digit OTP');
            return;
        }
        setVerifying(true);
        try {
            const res = await apiFetch('/api/auth/email/verify-otp', {
                method: 'POST',
                body: JSON.stringify({ email: signupEmail, otp: signupOtp })
            });
            const data = await res.json();
            if (res.ok && data.user) {
                toast.success('Welcome to JDLX Mobile! 🎉');
                // Full reload so initAuth picks up the HttpOnly cookie session.
                window.location.href = window.location.origin;
            } else {
                toast.error(data.error || 'Verification failed. Please try again.');
            }
        } catch (err) {
            toast.error('Network error. Please try again.');
        } finally {
            setVerifying(false);
        }
    };

    // ─── Google OTP verification (existing account login/link) ───────────────
    const handleLinkVerify = async (e) => {
        e.preventDefault();
        if (!linkOtp || linkOtp.length !== 6) {
            toast.error('Please enter the 6-digit OTP');
            return;
        }
        try {
            const res = await apiFetch('/api/auth/google/link-verify', {
                method: 'POST',
                body: JSON.stringify({ email: linkEmail, otp: linkOtp, google_id: linkGoogleId })
            });
            const data = await res.json();
            if (res.ok && data.user) {
                toast.success('Login successful!');
                window.location.href = window.location.origin;
            } else {
                toast.error(data.error || 'Verification failed');
            }
        } catch (err) {
            toast.error('Network error. Please try again.');
        }
    };

    // ─── OTP resend + expiry row (shared by signup + google-link flows) ──────
    const otpResendRow = (onResend, busy) => (
        <div className="w-full mt-2 flex flex-col items-center gap-2">
            <p className={`text-[11px] font-semibold ${otpExpiry.seconds > 0 && otpExpiry.seconds < 60 ? 'text-red-500' : 'text-gray-400'}`}>
                ⏳ OTP expires in {formatClock(otpExpiry.seconds)}
            </p>
            <button
                onClick={onResend}
                disabled={resendCooldown.seconds > 0 || busy}
                className="text-xs font-semibold text-primary hover:underline disabled:text-gray-400 disabled:hover:no-underline transition-colors"
            >
                {resendCooldown.seconds > 0
                    ? `Resend OTP in ${formatClock(resendCooldown.seconds)}`
                    : busy ? 'Sending…' : 'Resend OTP'}
            </button>
        </div>
    );

    const handleResendSignupOtp = async () => {
        if (resendCooldown.seconds > 0) return;
        setSending(true);
        try {
            const res = await apiFetch('/api/auth/email/send-otp', {
                method: 'POST',
                body: JSON.stringify({ email: signupEmail })
            });
            const data = await res.json();
            if (res.ok) {
                applyOtpResponseInfo(data);
                toast.success('New OTP sent ✉️');
            } else {
                // 429 cooldown: sync the escalating wait from the backend.
                applyOtpResponseInfo(data);
                toast.error(data.error || 'Please try again in a moment.');
            }
        } catch (err) {
            toast.error('Network error. Please try again.');
        } finally {
            setSending(false);
        }
    };

    const handleResendLinkOtp = async () => {
        if (resendCooldown.seconds > 0) return;
        setSending(true);
        try {
            const res = await apiFetch('/api/auth/google/link-resend', {
                method: 'POST',
                body: JSON.stringify({ email: linkEmail, google_id: linkGoogleId })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                applyOtpResponseInfo(data);
                toast.success('New OTP sent to your email ✉️');
            } else {
                // 429 cooldown: sync the escalating wait from the backend.
                applyOtpResponseInfo(data);
                toast.error(data.error || 'Please try again in a moment.');
            }
        } catch (err) {
            toast.error('Network error. Please try again.');
        } finally {
            setSending(false);
        }
    };

    // ─── OTP help / spam-folder tip (shared by signup + google-link flows) ────
    const otpHelpNote = (
        <div className="w-full mt-3 rounded-2xl bg-[var(--color-surface-container)] border border-[var(--color-surface-high)] px-4 py-3 text-left">
            <p className="text-[11px] font-bold text-[var(--color-on-surface)]">📩 Didn't get the email?</p>
            <ul className="mt-1.5 space-y-1 text-[11px] text-[var(--color-on-surface-variant)] leading-relaxed">
                <li>• Check your <b className="text-[var(--color-on-surface)]">Spam</b> or <b className="text-[var(--color-on-surface)]">Promotions</b> folder</li>
                <li>• Add <b className="text-[var(--color-on-surface)]">jdlxofficial@gmail.com</b> to your contacts so future OTPs always arrive</li>
                <li>• Delivery can take up to a minute — use <b className="text-[var(--color-on-surface)]">Resend OTP</b> after the countdown if needed</li>
            </ul>
        </div>
    );

    // ─── OTP entry screen (shared by signup + google-link flows) ─────────────
    const otpScreen = (email, otp, setOtp, onSubmit, title, subtitle, cta, busy) => (
        <form onSubmit={onSubmit} className="w-full mt-4 flex flex-col items-center gap-4">
            <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="Enter 6-digit OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className="w-[320px] max-w-full bg-[var(--color-surface-card)] border border-gray-300 rounded-full px-6 py-3 text-center text-2xl font-mono tracking-widest text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                autoFocus
            />
            <button
                type="submit"
                disabled={busy}
                className="flex items-center justify-center gap-3 w-[320px] max-w-full bg-primary text-white rounded-full px-6 py-3 font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
            >
                {busy ? (
                    <>
                        <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Verifying…
                    </>
                ) : cta}
            </button>
        </form>
    );

    // ─── Google OTP verification screen (existing account) ───────────────────
    if (mode === 'link-required') {
        return (
            <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
                <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                    <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner">
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--color-on-surface)] tracking-tight">Verify Your Login</h1>
                        <p className="text-[var(--color-on-surface-variant)] text-sm mt-2">An account with {linkEmail} already exists. We sent a 6-digit OTP to this email — enter it to complete login.</p>
                    </div>

                    {otpScreen(
                        linkEmail, linkOtp, setLinkOtp, handleLinkVerify,
                        null, null, 'Verify & Login', verifying
                    )}

                    {otpResendRow(handleResendLinkOtp, sending)}
                    {otpHelpNote}

                    <p className="text-xs text-gray-400 mt-4 leading-relaxed">
                        By continuing, you agree to our Terms of Service and Privacy Policy.
                    </p>
                </div>
            </div>
        );
    }

    // ─── Signup email entry ───────────────────────────────────────────────────
    if (mode === 'signup-email') {
        return (
            <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
                <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                    <BackButton onClick={() => setMode('choice')} />
                    <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner text-3xl">
                        ✨
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--color-on-surface)] tracking-tight">Create Your Account</h1>
                        <p className="text-[var(--color-on-surface-variant)] text-sm mt-2">Enter your email — we'll send a one-time OTP to verify and create your account.</p>
                    </div>

                    <form onSubmit={handleSendOtp} className="w-full mt-4 flex flex-col items-center gap-4">
                        <input
                            type="email"
                            placeholder="Your email address"
                            value={signupEmail}
                            onChange={(e) => setSignupEmail(e.target.value)}
                            className="w-[320px] max-w-full bg-[var(--color-surface-card)] border border-gray-300 rounded-full px-6 py-3 text-center text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                            autoFocus
                        />
                        <button
                            type="submit"
                            disabled={sending}
                            className="flex items-center justify-center gap-3 w-[320px] max-w-full bg-primary text-white rounded-full px-6 py-3 font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
                        >
                            {sending ? (
                                <>
                                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Sending…
                                </>
                            ) : 'Send OTP'}
                        </button>
                    </form>

                    <p className="text-xs text-gray-400 mt-4 leading-relaxed">
                        Already have an account? <button className="text-primary font-semibold" onClick={handleGoogleLogin}>Continue with Google</button>
                    </p>
                </div>
            </div>
        );
    }

    // ─── Signup OTP entry ─────────────────────────────────────────────────────
    if (mode === 'signup-otp') {
        return (
            <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
                <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                    <BackButton onClick={() => setMode('signup-email')} />
                    <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner text-3xl">
                        🔐
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--color-on-surface)] tracking-tight">Enter OTP</h1>
                        <p className="text-[var(--color-on-surface-variant)] text-sm mt-2">We sent a 6-digit OTP to <b className="text-[var(--color-on-surface)]">{signupEmail}</b>. Enter it below to continue.</p>
                    </div>

                    {otpScreen(
                        signupEmail, signupOtp, setSignupOtp, handleVerifyOtp,
                        null, null, 'Verify & Create Account', verifying
                    )}

                    {otpResendRow(handleResendSignupOtp, sending)}
                    {otpHelpNote}
                </div>
            </div>
        );
    }

    // ─── Main choice screen ───────────────────────────────────────────────────
    return (
        <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
            <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner">
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-on-surface)] tracking-tight">Welcome to JDLX Mobile</h1>
                    <p className="text-[var(--color-on-surface-variant)] text-sm mt-2">New here? Create an account in seconds. Already shopping with us? Sign in with Google.</p>
                </div>

                <div className="w-full mt-4 flex flex-col gap-3 items-center">
                    {/* New user signup (email + OTP) */}
                    <button
                        onClick={() => setMode('signup-email')}
                        className="flex items-center justify-center gap-3 w-[320px] max-w-full bg-primary text-white rounded-full px-6 py-3 font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                        ✨ Create New Account
                    </button>

                    <div className="flex items-center gap-3 w-[320px] max-w-full">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">or</span>
                        <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Existing account login (Google + OTP) */}
                    <button
                        onClick={handleGoogleLogin}
                        className="flex items-center justify-center gap-3 w-[320px] max-w-full bg-[var(--color-surface-card)] border border-gray-300 rounded-full px-6 py-3 text-[var(--color-on-surface-variant)] font-medium hover:bg-[var(--color-surface-low)] transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                        <GoogleIcon />
                        Continue with Google
                    </button>
                    <p className="text-[11px] text-gray-400 -mt-1">Already have an account? Verify with your Gmail OTP</p>
                </div>

                <p className="text-xs text-gray-400 mt-4 leading-relaxed">
                    By continuing, you agree to our Terms of Service and Privacy Policy.
                </p>
            </div>
        </div>
    )
}

export default Login