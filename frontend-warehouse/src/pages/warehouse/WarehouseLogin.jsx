import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Building2, FileText, ShieldCheck, Package, Truck, BarChart, Bike, ReceiptText, KeyRound, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { API_BASE_URL, API_ORIGIN } from '../../config'
import { useStore } from '../../store/useStore'

function WarehouseLogin() {
    const location = useLocation()
    const navigate = useNavigate()
    const warehouseToken = useStore((state) => state.warehouseToken)
    const setWarehouseUser = useStore((state) => state.setWarehouseUser)

    const params = useMemo(() => new URLSearchParams(location.search), [location.search])
    const errorCode = params.get('error')

    const [loading, setLoading] = useState(false)
    const [deliveryLoading, setDeliveryLoading] = useState(false)

    // Billing agent (staff) login
    const [staffEmail, setStaffEmail] = useState('')
    const [staffPassword, setStaffPassword] = useState('')
    const [staffLoading, setStaffLoading] = useState(false)
    const [staffError, setStaffError] = useState('')

    // Link required state
    const [linkRequired, setLinkRequired] = useState(false)
    const [linkEmail, setLinkEmail] = useState('')
    const [linkGoogleId, setLinkGoogleId] = useState('')
    const [linkOtp, setLinkOtp] = useState('')
    const [linkVerifying, setLinkVerifying] = useState(false)

    // Handle redirect-based oauth token in URL (legacy support)
    useEffect(() => {
        const oauthToken = params.get('oauth_token')
        const oauthUser = params.get('oauth_user')
        if (oauthToken && oauthUser) {
            try {
                const warehouseUser = JSON.parse(decodeURIComponent(oauthUser))
                setWarehouseUser(warehouseUser, oauthToken)
                navigate('/warehouse/dashboard', { replace: true })
                return
            } catch (e) {
                console.error('Warehouse OAuth callback parsing failed:', e)
            }
        }
        if (warehouseToken) {
            // Billing agents only have POS access — send them straight to
            // billing. Owners/managers go to the dashboard. (Without this,
            // staff logins were bounced to /warehouse/dashboard and got an
            // Access Denied screen instead of the POS.)
            const sessionUser = useStore.getState().warehouseUser
            const sessionRole = (sessionUser?.role || sessionUser?.role_name || '').toLowerCase()
            if (sessionRole.includes('billing') || sessionRole.includes('staff')) {
                navigate('/warehouse/billing', { replace: true })
            } else {
                navigate('/warehouse/dashboard', { replace: true })
            }
        }
    }, [navigate, params, setWarehouseUser, warehouseToken])

    // Handle link_required from Google OAuth
    useEffect(() => {
        const linkReq = params.get('link_required')
        if (linkReq === 'true') {
            setLinkRequired(true)
            setLinkEmail(params.get('email') || '')
            setLinkGoogleId(params.get('google_id') || '')
        }
    }, [params])

    const errorMessage = useMemo(() => {
        if (errorCode === 'not_authorized') return 'Your Google account is not linked to an approved warehouse partner yet.'
        if (errorCode === 'session_expired') return 'Your warehouse session expired. Please sign in again.'
        if (errorCode === 'google_link_conflict') return 'This Google account is already linked to another account.'
        if (errorCode === 'otp_send_failed') return 'Could not send the OTP email. Please check your email address and try again.'
        return ''
    }, [errorCode])

    const handleGoogleLogin = (flowType) => {
        if (flowType === 'warehouse_login') setLoading(true)
        if (flowType === 'delivery_login') setDeliveryLoading(true)
        
        window.location.href = `${API_ORIGIN}/partner/login/google?flow=${flowType}`
    }

    const handleLinkVerify = async (e) => {
        e.preventDefault()
        if (!linkOtp || linkOtp.length !== 6) {
            toast.error('Please enter the 6-digit OTP')
            return
        }
        setLinkVerifying(true)
        try {
            const res = await fetch(`${API_ORIGIN}/api/auth/google/link-verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: linkEmail, otp: linkOtp, google_id: linkGoogleId })
            })
            const data = await res.json()
            if (res.ok && data.user) {
                toast.success('Google account linked successfully!')
                // Warehouse flow: link-verify returns the warehouse partner
                // session ({ user, token }), not a customer session. Persist it
                // under the warehouse keys so WarehouseRoute grants access.
                const token = data.token || data.user?.token || ''
                localStorage.setItem('warehouseToken', token)
                localStorage.setItem('warehouse_token', token)
                localStorage.setItem('warehouseUser', JSON.stringify(data.user))
                useStore.getState().setWarehouseUser(data.user, token)
                window.location.href = window.location.origin + '/warehouse/dashboard'
            } else {
                toast.error(data.error || 'Verification failed')
            }
        } catch (err) {
            toast.error('Network error. Please try again.')
        } finally {
            setLinkVerifying(false)
        }
    }

    const handleLinkResend = async () => {
        setLinkVerifying(true)
        try {
            const res = await fetch(`${API_ORIGIN}/api/auth/google/link-resend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: linkEmail, google_id: linkGoogleId })
            })
            const data = await res.json()
            if (res.ok) {
                toast.success('OTP resent. Check your email inbox (and spam folder).')
            } else {
                toast.error(data.error || 'Could not resend the OTP. Please wait and try again.')
            }
        } catch (err) {
            toast.error('Network error. Please try again.')
        } finally {
            setLinkVerifying(false)
        }
    }

    const handleStaffLogin = async (e) => {
        e.preventDefault()
        setStaffError('')
        if (!staffEmail || !staffPassword) {
            setStaffError('Please enter your email and password.')
            return
        }
        setStaffLoading(true)
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/staff/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: staffEmail, password: staffPassword })
            })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || data.message || 'Login failed')
            }
            // Store staff token in the same keys StaffSetupPassword uses, and
            // also sync into the shared store so WarehouseRoute grants access.
            if (data.token) {
                localStorage.setItem('warehouse_token', data.token)
                localStorage.setItem('staff_token', data.token)
                localStorage.setItem('warehouse_user', JSON.stringify(data.user))
                localStorage.setItem('warehouseUser', JSON.stringify(data.user))
                localStorage.setItem('warehouseToken', data.token)
            }
            if (data.user) {
                useStore.getState().setWarehouseUser(data.user, data.token)
            }
            toast.success(`Welcome back, ${data.user?.name || 'Agent'}!`)
            navigate('/warehouse/billing', { replace: true })
        } catch (err) {
            console.error('Staff login error:', err)
            setStaffError(err.message || 'Login failed')
        } finally {
            setStaffLoading(false)
        }
    }

    if (linkRequired) {
        return (
            <div style={{
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '24px 16px', fontFamily: "'Inter', sans-serif",
            }}>
                <div style={{
                    width: '100%', maxWidth: '420px',
                    background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '24px', padding: '40px 36px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                        <div style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '14px', padding: '12px' }}>
                            <Loader2 size={24} style={{ color: '#fcd34d' }} />
                        </div>
                        <div>
                            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#fcd34d', marginBottom: '4px' }}>Link Account</p>
                            <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#f1f5f9', fontFamily: "'Manrope', sans-serif" }}>Link Google Account</h2>
                        </div>
                    </div>
                    <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '28px', textAlign: 'center' }}>
                        An account with <strong>{linkEmail}</strong> already exists. Enter the OTP sent to this email to link your Google account.
                    </p>

                    <form onSubmit={handleLinkVerify} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <input
                            type="text"
                            maxLength={6}
                            placeholder="Enter 6-digit OTP"
                            value={linkOtp}
                            onChange={(e) => setLinkOtp(e.target.value)}
                            style={{
                                width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '12px', padding: '16px 20px', color: '#fff',
                                fontSize: '20px', fontFamily: 'monospace', letterSpacing: '0.3em', textAlign: 'center',
                                outline: 'none', fontWeight: 700, boxSizing: 'border-box'
                            }}
                            autoFocus
                        />
                        <button
                            type="submit"
                            disabled={linkVerifying}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                padding: '14px 24px', background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                                color: '#000', borderRadius: '12px', border: 'none', width: '100%',
                                fontWeight: 700, fontSize: '14px', cursor: linkVerifying ? 'not-allowed' : 'pointer',
                                opacity: linkVerifying ? 0.7 : 1, fontFamily: "'Inter', sans-serif",
                            }}
                        >
                            {linkVerifying ? <Loader2 size={16} style={{ color: '#000' }} /> : 'Verify & Link'}
                        </button>
                    </form>

                    <button
                        type="button"
                        onClick={handleLinkResend}
                        disabled={linkVerifying}
                        style={{
                            background: 'none', border: 'none', cursor: linkVerifying ? 'not-allowed' : 'pointer',
                            color: '#5eead4', fontSize: '13px', fontWeight: 600, textAlign: 'center',
                            marginTop: '12px', textDecoration: 'underline', fontFamily: "'Inter', sans-serif", opacity: linkVerifying ? 0.6 : 1,
                        }}
                    >
                        Didn't get the OTP? Resend
                    </button>

                    <p style={{ fontSize: '12px', color: '#64748b', marginTop: '20px', textAlign: 'center' }}>
                        By continuing, you agree to our Terms of Service and Privacy Policy.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px 16px', fontFamily: "'Inter', sans-serif",
        }}>
            <div style={{
                width: '100%', maxWidth: '960px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '24px', alignItems: 'stretch',
            }}>
                {/* Left – Brand panel */}
                <div style={{
                    background: 'linear-gradient(145deg, #0d1b2a 0%, #1a2942 100%)',
                    borderRadius: '24px', border: '1px solid rgba(255,255,255,0.08)',
                    padding: '40px 36px', color: '#fff', position: 'relative', overflow: 'hidden',
                }}>
                    <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '200px', height: '200px', background: 'radial-gradient(circle, rgba(20,184,166,0.2) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', bottom: '-60px', left: '-20px', width: '160px', height: '160px', background: 'radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: '100px', padding: '6px 16px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5eead4', marginBottom: '28px' }}>
                        <Building2 size={14} /> JDLX Mobile Partner Portal
                    </div>
                    <h1 style={{ fontSize: '28px', fontWeight: 900, lineHeight: 1.25, marginBottom: '16px', color: '#f1f5f9', fontFamily: "'Manrope', sans-serif" }}>
                        Manage warehouse <br /> &amp; delivery operations <br /> in one place.
                    </h1>
                    <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#94a3b8', marginBottom: '32px' }}>
                        Sign in with your approved Google account to access your designated partner dashboard based on your role (Warehouse or Delivery).
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        {[
                            { icon: ShieldCheck, title: 'OAuth Verified', text: 'Only approved warehouse accounts can access this portal.' },
                            { icon: BarChart, title: 'Ops Dashboard', text: 'View pending orders, low stock alerts and dispatch activity.' },
                            { icon: Package, title: 'Inventory', text: 'Track stock levels and low-stock alerts in real time.' },
                            { icon: Truck, title: 'Dispatch', text: 'Monitor order packing and dispatch performance.' },
                        ].map(({ icon, title, text }) => (
                            <div key={title} style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '20px' }}>
                                <div style={{ marginBottom: '12px' }}>
                                    {icon === BarChart && <BarChart size={20} color="#0ea5e9" />}
                                    {icon === ShieldCheck && <ShieldCheck size={20} color="#0ea5e9" />}
                                    {icon === Package && <Package size={20} color="#0ea5e9" />}
                                    {icon === Truck && <Truck size={20} color="#0ea5e9" />}
                                </div>
                                <p style={{ fontSize: '13px', fontWeight: 700, color: '#f1f5f9', marginBottom: '4px' }}>{title}</p>
                                <p style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>{text}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right – Login card */}
                <div style={{
                    background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '24px', padding: '40px 36px',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                        <div style={{ background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: '14px', padding: '12px' }}>
                            <ShieldCheck size={24} style={{ color: '#5eead4' }} />
                        </div>
                        <div>
                            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#5eead4', marginBottom: '4px' }}>Secure Sign-In</p>
                            <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#f1f5f9', fontFamily: "'Manrope', sans-serif" }}>Partner Login</h2>
                        </div>
                    </div>
                    <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '28px' }}>
                        Select your partner role below to securely access your portal.
                    </p>

                    {errorMessage && (
                        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '14px', padding: '14px 18px', fontSize: '14px', color: '#fcd34d', marginBottom: '20px', lineHeight: '1.5' }}>
                            {errorMessage}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
                        {/* Warehouse Login Option */}
                        <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                <Building2 size={18} style={{ color: '#5eead4' }} />
                                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Warehouse Access</h3>
                            </div>
                            <button
                                onClick={() => handleGoogleLogin('warehouse_login')}
                                disabled={loading || deliveryLoading}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                    padding: '14px 24px', background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                    color: '#fff', borderRadius: '12px', border: 'none', width: '100%',
                                    fontWeight: 700, fontSize: '14px', cursor: (loading || deliveryLoading) ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 4px 16px rgba(20,184,166,0.2)', opacity: loading ? 0.7 : 1,
                                    fontFamily: "'Inter', sans-serif",
                                }}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/>
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff"/>
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff"/>
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff"/>
                                </svg>
                                {loading ? 'Signing in...' : 'Warehouse Login'}
                            </button>
                        </div>

                        {/* Delivery Partner Login Option */}
                        <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                <Bike size={18} style={{ color: '#fbbf24' }} />
                                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Delivery Partner Access</h3>
                            </div>
                            <button
                                onClick={() => handleGoogleLogin('delivery_login')}
                                disabled={loading || deliveryLoading}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                    padding: '14px 24px', background: 'rgba(255,255,255,0.08)',
                                    color: '#fff', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)', width: '100%',
                                    fontWeight: 700, fontSize: '14px', cursor: (loading || deliveryLoading) ? 'not-allowed' : 'pointer',
                                    opacity: deliveryLoading ? 0.7 : 1,
                                    fontFamily: "'Inter', sans-serif",
                                }}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/>
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff"/>
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff"/>
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff"/>
                                </svg>
                                {deliveryLoading ? 'Signing in...' : 'Delivery Login'}
                            </button>
                        </div>

                        {/* Billing Agent (Staff) Login Option */}
                        <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                <ReceiptText size={18} style={{ color: '#a78bfa' }} />
                                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Billing Agent Access</h3>
                                <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd', borderRadius: '100px', padding: '4px 10px' }}>
                                    Email + Password
                                </span>
                            </div>
                            <form onSubmit={handleStaffLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <input
                                    type="email"
                                    placeholder="Agent email"
                                    value={staffEmail}
                                    onChange={(e) => setStaffEmail(e.target.value)}
                                    style={{
                                        padding: '12px 16px', background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
                                        color: '#f1f5f9', fontSize: '14px', outline: 'none',
                                        fontFamily: "'Inter', sans-serif",
                                    }}
                                    disabled={staffLoading}
                                />
                                <input
                                    type="password"
                                    placeholder="Password"
                                    value={staffPassword}
                                    onChange={(e) => setStaffPassword(e.target.value)}
                                    style={{
                                        padding: '12px 16px', background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
                                        color: '#f1f5f9', fontSize: '14px', outline: 'none',
                                        fontFamily: "'Inter', sans-serif",
                                    }}
                                    disabled={staffLoading}
                                />
                                {staffError && (
                                    <p style={{ fontSize: '12px', color: '#fca5a5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', padding: '10px 12px', margin: 0, lineHeight: '1.5' }}>
                                        {staffError}
                                    </p>
                                )}
                                <button
                                    type="submit"
                                    disabled={staffLoading}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                        padding: '14px 24px', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                                        color: '#fff', borderRadius: '12px', border: 'none', width: '100%',
                                        fontWeight: 700, fontSize: '14px', cursor: staffLoading ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 4px 16px rgba(139,92,246,0.2)', opacity: staffLoading ? 0.7 : 1,
                                        fontFamily: "'Inter', sans-serif",
                                    }}
                                >
                                    {staffLoading ? (
                                        <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Signing in...</>
                                    ) : (
                                        <><KeyRound size={16} /> Billing Agent Login</>
                                    )}
                                </button>
                            </form>
                            <p style={{ fontSize: '11px', color: '#64748b', margin: '12px 0 0', lineHeight: '1.5' }}>
                                Billing agents get access to the Counter Billing (POS) only. Ask your warehouse manager for your login credentials.
                            </p>
                        </div>

                        <Link to="/warehouse/request" style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                            padding: '14px 24px', background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1',
                            borderRadius: '14px', textDecoration: 'none', fontWeight: 600, fontSize: '14px',
                        }}>
                            <FileText size={15} /> Apply for warehouse access
                        </Link>

                        <Link to="/warehouse/request-delivery" style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                            padding: '14px 24px', background: 'rgba(20,184,166,0.08)',
                            border: '1px solid rgba(20,184,166,0.15)', color: '#5eead4',
                            borderRadius: '14px', textDecoration: 'none', fontWeight: 600, fontSize: '14px',
                        }}>
                            <Truck size={15} /> Apply to be a Delivery Partner
                        </Link>

                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '20px' }}>
                        <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#475569', marginBottom: '14px' }}>Expected flow</p>
                        {['Google sign-in popup opens in the browser.', 'Approved partner membership is verified.', 'You are redirected to your partner dashboard.'].map((step, i) => (
                            <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: i < 2 ? '10px' : 0 }}>
                                <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#5eead4', flexShrink: 0 }}>{i + 1}</div>
                                <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, paddingTop: '2px' }}>{step}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default WarehouseLogin
