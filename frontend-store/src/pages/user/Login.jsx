import { useEffect, useState } from 'react'
import toast from "react-hot-toast"
import { API_BASE_URL } from '../../config'

function Login() {
    const [linkRequired, setLinkRequired] = useState(false);
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
            toast.error("Google login failed. Please try again.");
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // Handle link_required from Google OAuth
        const linkReq = params.get('link_required');
        if (linkReq === 'true') {
            setLinkRequired(true);
            setLinkEmail(params.get('email') || '');
            setLinkGoogleId(params.get('google_id') || '');
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, []);

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

    const handleLinkVerify = async (e) => {
        e.preventDefault();
        if (!linkOtp || linkOtp.length !== 6) {
            toast.error('Please enter the 6-digit OTP');
            return;
        }
        try {
            const origin = API_BASE_URL.replace(/\/api\/?$/, '');
            const res = await fetch(`${origin}/api/auth/google/link-verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: linkEmail, otp: linkOtp, google_id: linkGoogleId })
            });
            const data = await res.json();
            if (res.ok && data.user) {
                toast.success('Google account linked successfully!');
                // Store token and redirect
                localStorage.setItem('token', data.user.token || '');
                window.location.href = window.location.origin;
            } else {
                toast.error(data.error || 'Verification failed');
            }
        } catch (err) {
            toast.error('Network error. Please try again.');
        }
    };

    if (linkRequired) {
        return (
            <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
                <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                    <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner">
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--color-on-surface)] tracking-tight">Link Google Account</h1>
                        <p className="text-[var(--color-on-surface-variant)] text-sm mt-2">An account with {linkEmail} already exists. Enter the OTP sent to this email to link your Google account.</p>
                    </div>

                    <form onSubmit={handleLinkVerify} className="w-full mt-4 flex flex-col items-center gap-4">
                        <input
                            type="text"
                            maxLength={6}
                            placeholder="Enter 6-digit OTP"
                            value={linkOtp}
                            onChange={(e) => setLinkOtp(e.target.value)}
                            className="w-[320px] max-w-full bg-[var(--color-surface-card)] border border-gray-300 rounded-full px-6 py-3 text-center text-2xl font-mono tracking-widest text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                            autoFocus
                        />
                        <button 
                            type="submit"
                            className="flex items-center justify-center gap-3 w-[320px] max-w-full bg-primary text-white rounded-full px-6 py-3 font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                        >
                            Verify & Link
                        </button>
                    </form>

                    <p className="text-xs text-gray-400 mt-4 leading-relaxed">
                        By continuing, you agree to our Terms of Service and Privacy Policy.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="container-standard flex flex-col items-center justify-center min-h-[70vh]">
            <div className="glass-card w-full max-w-sm p-8 text-center flex flex-col items-center gap-6">
                <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-2 shadow-inner">
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" /></svg>
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-on-surface)] tracking-tight">Welcome to JDLX Mobile</h1>
                    <p className="text-[var(--color-on-surface-variant)] text-sm mt-2">Sign in for a better experience and continue your shopping.</p>
                </div>

                <div className="w-full mt-4 flex justify-center">
                    <button 
                        onClick={handleGoogleLogin}
                        className="flex items-center justify-center gap-3 w-[320px] max-w-full bg-[var(--color-surface-card)] border border-gray-300 rounded-full px-6 py-3 text-[var(--color-on-surface-variant)] font-medium hover:bg-[var(--color-surface-low)] transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
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
