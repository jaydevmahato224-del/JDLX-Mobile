import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { API_BASE_URL, STORE_FRONTEND_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'
import { Loader2, Mail, Lock, Smartphone, ShieldQuestion, ArrowLeft, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import adminLogo from '../../assets/admin-logo.svg'

// Backend-sanctioned security questions (must match SECURITY_QUESTIONS list).
const SECURITY_QUESTIONS = [
    "What was the name of your first school?",
    "What is your mother's maiden name?",
    "What was the make of your first car/bike?",
    "What is the name of the street you grew up on?",
    "What was your childhood nickname?",
]

function AdminLogin() {
    const navigate = useNavigate();
    const adminUser = useStore(state => state.adminUser);
    const setAdminUser = useStore(state => state.setAdminUser);

    // 'login' | 'forgot'
    const [mode, setMode] = useState('login')
    const [loginMethod, setLoginMethod] = useState('email') // 'email' | 'phone'
    const [identifier, setIdentifier] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [formError, setFormError] = useState(null)

    // Forgot-password state
    const [fpStep, setFpStep] = useState(1) // 1: identify, 2: answer + new password
    const [fpQuestion, setFpQuestion] = useState('')
    const [fpAnswer, setFpAnswer] = useState('')
    const [fpNewPassword, setFpNewPassword] = useState('')
    const [fpConfirmPassword, setFpConfirmPassword] = useState('')
    const [fpLoading, setFpLoading] = useState(false)

    // OAuth bootstrap — the backend admin callback now redirects here with
    // ?oauth_token=...&oauth_user=... (same pattern as the warehouse/delivery
    // flows). The auth cookie is HttpOnly so the SPA can't read it, and without
    // this snapshot adminUser stayed null and AdminRoute bounced every admin
    // straight back to /admin/login (the login loop). Consumed once, then
    // scrubbed from the address bar so the token never lingers in the URL.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const oauthToken = params.get('oauth_token');
        const oauthUser = params.get('oauth_user');
        if (!oauthToken || !oauthUser) return;

        try {
            const userData = JSON.parse(decodeURIComponent(oauthUser));
            const role = (userData.role || '').toLowerCase();
            const ADMIN_ROLES = ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin'];
            if (ADMIN_ROLES.includes(role)) {
                setAdminUser(userData);
                localStorage.setItem('adminToken', oauthToken);
                window.history.replaceState({}, '', '/admin/dashboard');
                navigate('/admin/dashboard', { replace: true });
            } else {
                // Backend already gates non-admins; this is defense in depth.
                window.history.replaceState({}, '', '/admin/login?error=unauthorized');
            }
        } catch (err) {
            console.error('Failed to parse admin OAuth callback data', err);
            window.history.replaceState({}, '', '/admin/login?error=oauth_failed');
        }
    }, [setAdminUser, navigate]);
    // Parse OAuth error query params once at mount — they never change during
    // the page's lifetime, so a lazy initializer replaces the effect cleanly.
    const [errorMessage] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        const details = params.get('details');
        const reason = params.get('reason');
        if (reason === 'session_expired') {
            return "Your session has expired. Please sign in again.";
        }
        if (error) {
            console.error('OAuth Error:', error, details);
            if (error === 'not_authorized' || error === 'unauthorized') {
                return "You are not authorized to access the admin panel.";
            } else if (error === 'oauth_failed') {
                return "Google Sign-In failed. Session mismatch or cookie issue. Try incognito mode.";
            } else if (error === 'csrf_validation_failed') {
                return "Security validation failed. Please try signing in again.";
            } else if (error === 'account_locked') {
                return "Account temporarily locked due to too many failed attempts. Try again later.";
            } else {
                return `Login failed: ${error} ${details ? '(' + details + ')' : ''}`;
            }
        }
        return null;
    });

    // Auto-redirect if already logged in as admin (all admin roles, matching
    // the role whitelist AdminRoute enforces — previously super_admin and the
    // sub-admin roles were missed here and got stuck on the login page).
    useEffect(() => {
        const role = (adminUser?.role || '').toLowerCase();
        if (adminUser && ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin'].includes(role)) {
            navigate('/admin/dashboard', { replace: true });
        }
    }, [adminUser, navigate]);

    // Same logic as before, using backend OAuth URL
    const backendOrigin = API_BASE_URL
        .replace(/\/api\/?$/, '');
    const frontendUrl = encodeURIComponent(window.location.origin);
    const oauthLoginUrl = `${backendOrigin}/admin/login/google?frontend_url=${frontendUrl}`;

    // ---------------- Password login ----------------
    const handlePasswordLogin = async (e) => {
        e.preventDefault()
        setFormError(null)
        if (!identifier.trim() || !password) {
            setFormError(loginMethod === 'email' ? 'Email and password are required' : 'Mobile number and password are required')
            return
        }
        setLoading(true)
        try {
            const res = await fetch(`${API_BASE_URL}/admin/login-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ identifier: identifier.trim(), password })
            })
            const data = await res.json()
            if (data.success) {
                // Same token hygiene as AdminReauthModal: cookie carries the
                // fresh JWT; drop any stale Bearer snapshot so the header can
                // never shadow the newer cookie.
                try {
                    localStorage.removeItem('adminToken');
                    localStorage.removeItem('admin_token');
                } catch (e) { /* storage unavailable */ }
                setAdminUser(data.user)
                toast.success(`Welcome back, ${data.user?.name || 'Admin'}!`)
                navigate('/admin/dashboard', { replace: true })
            } else {
                setFormError(data.error || 'Invalid credentials')
            }
        } catch {
            setFormError('Network error. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    // ---------------- Forgot password ----------------
    const handleForgotIdentify = async (e) => {
        e.preventDefault()
        setFormError(null)
        if (!identifier.trim()) {
            setFormError('Enter your email or mobile number first')
            return
        }
        setFpLoading(true)
        try {
            const res = await apiFetch('/admin/security/status-lookup', {
                method: 'POST',
                body: JSON.stringify({ identifier: identifier.trim() }),
                skipGlobalError: true
            })
            const data = await res.json()
            // Enumeration-safe by design: the backend answers EVERY identifier
            // with a question (unknown accounts get a decoy). The reset step
            // fails generically for accounts that can't actually reset.
            if (data.success && data.data?.security_question) {
                setFpQuestion(data.data.security_question)
                setFpStep(2)
            } else {
                setFormError(data.error || 'Could not start password reset')
            }
        } catch {
            setFormError('Network error. Please try again.')
        } finally {
            setFpLoading(false)
        }
    }

    const handleForgotReset = async (e) => {
        e.preventDefault()
        setFormError(null)
        if (!fpAnswer.trim()) { setFormError('Please answer your security question'); return }
        if (fpNewPassword.length < 8) { setFormError('Password must be at least 8 characters'); return }
        if (!/[A-Za-z]/.test(fpNewPassword) || !/\d/.test(fpNewPassword)) { setFormError('Password must contain both letters and numbers'); return }
        if (fpNewPassword !== fpConfirmPassword) { setFormError('Passwords do not match'); return }

        setFpLoading(true)
        try {
            const res = await apiFetch('/admin/security/reset-password', {
                method: 'POST',
                body: JSON.stringify({
                    identifier: identifier.trim(),
                    security_answer: fpAnswer.trim(),
                    new_password: fpNewPassword
                }),
                skipGlobalError: true
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Password reset successfully. Please log in.')
                // Back to login with the identifier prefilled
                setMode('login')
                setFpStep(1)
                setFpAnswer('')
                setFpNewPassword('')
                setFpConfirmPassword('')
                setPassword('')
            } else {
                setFormError(data.error || 'Password reset failed')
            }
        } catch {
            setFormError('Network error. Please try again.')
        } finally {
            setFpLoading(false)
        }
    }

    const switchLoginMethod = (method) => {
        setLoginMethod(method)
        setIdentifier('')
        setFormError(null)
    }

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">

            {/* Background Decor */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-blue-500/10 blur-[100px] rounded-full"></div>
            </div>

            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 relative z-10 border border-white/20">
                <div className="flex flex-col items-center mb-6">
                    <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-black/10 p-2">
                        <img src={adminLogo} alt="JDLX admin logo" className="w-full h-full object-contain" />
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight text-center">JDLX Official Admin Panel</h1>
                    <p className="text-sm text-slate-500 mt-1">Authorized personnel only.</p>
                </div>

                {(errorMessage || formError) && (
                    <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium text-center">
                        {errorMessage || formError}
                    </div>
                )}

                {mode === 'login' ? (
                    <>
                        {/* Method toggle: Email | Mobile */}
                        <div className="flex bg-slate-100 rounded-xl p-1 mb-5">
                            <button
                                type="button"
                                onClick={() => switchLoginMethod('email')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${loginMethod === 'email' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                <Mail size={14} /> Email
                            </button>
                            <button
                                type="button"
                                onClick={() => switchLoginMethod('phone')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${loginMethod === 'phone' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                <Smartphone size={14} /> Mobile
                            </button>
                        </div>

                        <form onSubmit={handlePasswordLogin} className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">
                                    {loginMethod === 'email' ? 'Email Address' : 'Mobile Number'}
                                </label>
                                <div className="relative">
                                    {loginMethod === 'email'
                                        ? <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                        : <Smartphone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />}
                                    <input
                                        type={loginMethod === 'email' ? 'email' : 'tel'}
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        placeholder={loginMethod === 'email' ? 'admin@jdlx.com' : '9876543210'}
                                        autoComplete="username"
                                        className="w-full bg-slate-50 border-2 border-slate-100 pl-11 pr-4 py-3.5 rounded-2xl text-sm font-bold text-slate-900 focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-300"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Password</label>
                                <div className="relative">
                                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        autoComplete="current-password"
                                        className="w-full bg-slate-50 border-2 border-slate-100 pl-11 pr-11 py-3.5 rounded-2xl text-sm font-bold text-slate-900 focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-300"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(s => !s)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                        tabIndex={-1}
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20 active:scale-95"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock size={16} />}
                                {loading ? 'Signing in…' : 'Sign In'}
                            </button>
                        </form>

                        <div className="text-center mt-3">
                            <button
                                onClick={() => { setMode('forgot'); setFormError(null); setFpStep(1); setFpAnswer(''); setFpNewPassword(''); setFpConfirmPassword('') }}
                                className="text-xs font-bold text-slate-400 hover:text-primary transition-colors"
                            >
                                Forgot password?
                            </button>
                        </div>

                        <div className="flex items-center gap-3 my-6">
                            <div className="h-px bg-slate-200 flex-1" />
                            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">or</span>
                            <div className="h-px bg-slate-200 flex-1" />
                        </div>

                        <div className="w-full flex justify-center mb-4">
                            <button
                                onClick={() => {
                                    try {
                                        localStorage.setItem('is_admin_login_attempt', 'true');
                                    } catch (e) {
                                        console.warn('Unable to access localStorage:', e);
                                    }
                                    window.location.href = oauthLoginUrl;
                                }}
                                className="flex items-center justify-center gap-3 w-full border border-gray-300 rounded-xl py-3 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors bg-white shadow-sm cursor-pointer"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Sign in with Google
                            </button>
                        </div>
                    </>
                ) : (
                    /* ---------------- FORGOT PASSWORD FLOW ---------------- */
                    <div>
                        <button
                            onClick={() => { setMode('login'); setFormError(null); setFpStep(1) }}
                            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors mb-5"
                        >
                            <ArrowLeft size={14} /> Back to sign in
                        </button>

                        {fpStep === 1 ? (
                            <form onSubmit={handleForgotIdentify} className="space-y-4">
                                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl mb-2">
                                    <ShieldQuestion size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-xs font-bold text-amber-700 leading-relaxed">
                                        Enter your account email or mobile. You'll be asked your security question to reset the password.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email or Mobile</label>
                                    <input
                                        type="text"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        placeholder="admin@jdlx.com or 9876543210"
                                        className="w-full bg-slate-50 border-2 border-slate-100 px-4 py-3.5 rounded-2xl text-sm font-bold text-slate-900 focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-300"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={fpLoading}
                                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20 active:scale-95"
                                >
                                    {fpLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldQuestion size={16} />}
                                    Continue
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleForgotReset} className="space-y-4">
                                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl mb-2">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Security Question</p>
                                    <p className="text-sm font-bold text-slate-800">{fpQuestion}</p>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Your Answer</label>
                                    <input
                                        type="text"
                                        value={fpAnswer}
                                        onChange={(e) => setFpAnswer(e.target.value)}
                                        placeholder="Your answer"
                                        autoFocus
                                        className="w-full bg-slate-50 border-2 border-slate-100 px-4 py-3.5 rounded-2xl text-sm font-bold text-slate-900 focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-300"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">New Password</label>
                                    <input
                                        type="password"
                                        value={fpNewPassword}
                                        onChange={(e) => setFpNewPassword(e.target.value)}
                                        placeholder="Min 8 chars, letters + numbers"
                                        autoComplete="new-password"
                                        className="w-full bg-slate-50 border-2 border-slate-100 px-4 py-3.5 rounded-2xl text-sm font-bold text-slate-900 focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-300"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Confirm New Password</label>
                                    <input
                                        type="password"
                                        value={fpConfirmPassword}
                                        onChange={(e) => setFpConfirmPassword(e.target.value)}
                                        placeholder="Repeat new password"
                                        autoComplete="new-password"
                                        className="w-full bg-slate-50 border-2 border-slate-100 px-4 py-3.5 rounded-2xl text-sm font-bold text-slate-900 focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-300"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={fpLoading}
                                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20 active:scale-95"
                                >
                                    {fpLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock size={16} />}
                                    Reset Password
                                </button>
                            </form>
                        )}
                    </div>
                )}

                <div className="text-center mt-6">
                    <button
                        onClick={() => {
                            window.location.href = `${STORE_FRONTEND_URL}/`;
                        }}
                        className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors hover:underline"
                    >
                        Return to Storefront
                    </button>
                </div>
            </div>

            <div className="absolute bottom-4 text-slate-500 text-xs font-medium">
                JDLX Official Admin Panel • v2.0
            </div>
        </div>
    )
}

export default AdminLogin
