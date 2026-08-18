import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
    AlertTriangle, ArrowRight, CheckCircle2, Clock3,
    FileText, RefreshCw, ShieldCheck, UserRoundCheck, XCircle,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

const INITIAL_FORM = {
    warehouse_name: '',
    owner_name: '',
    email: '',
    phone: '',
    address: '',
    pincode: '',
    warehouse_capacity: '',
    warehouse_type: 'micro_fulfillment',
}

const WAREHOUSE_TYPES = [
    { value: 'micro_fulfillment', label: 'Micro Fulfillment Center' },
    { value: 'dark_store', label: 'Dark Store' },
    { value: 'regional_hub', label: 'Regional Hub' },
    { value: 'cold_storage', label: 'Cold Storage' },
    { value: 'pharmacy', label: 'Pharmacy Warehouse' },
]

// ── Shared style tokens ──────────────────────────────────────────────────────
const s = {
    label: { fontSize: '13px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px', display: 'block' },
    input: {
        width: '100%', padding: '12px 16px', boxSizing: 'border-box',
        background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px', color: '#f1f5f9', fontSize: '14px', outline: 'none',
        fontFamily: "'Inter', sans-serif",
    },
    chip: (color) => ({
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 14px', borderRadius: '100px',
        fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
        background: `rgba(${color},0.12)`, border: `1px solid rgba(${color},0.25)`,
        color: `rgb(${color})`,
    }),
}

function WaitingModal({ open, onClose, application }) {
    if (!open) return null
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(2,6,23,0.7)', backdropFilter: 'blur(12px)',
            padding: '24px',
        }}>
            <div style={{
                width: '100%', maxWidth: '480px', background: '#0f172a',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px',
                padding: '36px', color: '#f1f5f9',
                boxShadow: '0 25px 80px rgba(0,0,0,0.5)',
            }}>
                <div style={s.chip('251,191,36')}>
                    <Clock3 size={12} /> Waiting for approval
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 900, margin: '20px 0 12px', fontFamily: "'Manrope',sans-serif" }}>
                    Request submitted successfully
                </h2>
                <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '24px' }}>
                    Your warehouse onboarding request is now in the admin approval queue. Until it is approved, the signup form stays locked and warehouse login will remain blocked.
                </p>
                {application && (
                    <div style={{
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '16px', padding: '18px', marginBottom: '24px',
                    }}>
                        <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Current request</p>
                        <p style={{ fontWeight: 700, fontSize: '16px' }}>{application.warehouse_name || 'Warehouse request'}</p>
                        <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>{application.email}</p>
                    </div>
                )}
                <button onClick={onClose} style={{
                    width: '100%', padding: '14px', background: '#fbbf24',
                    border: 'none', borderRadius: '12px', color: '#0f172a',
                    fontWeight: 700, fontSize: '15px', cursor: 'pointer',
                }}>
                    Okay, I will wait
                </button>
            </div>
        </div>
    )
}

function WarehouseRequest() {
    const navigate = useNavigate()
    const location = useLocation()
    const warehouseRequestUser = useStore((state) => state.warehouseRequestUser)
    const setWarehouseRequestUser = useStore((state) => state.setWarehouseRequestUser)

    const [formData, setFormData] = useState(INITIAL_FORM)
    const [statusData, setStatusData] = useState(null)
    const [loadingStatus, setLoadingStatus] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')
    const [showWaitingModal, setShowWaitingModal] = useState(false)

    const params = useMemo(() => new URLSearchParams(location.search), [location.search])
    const [googleLoading, setGoogleLoading] = useState(false)

    const currentStatus = statusData?.verification_status || null
    const application = statusData?.application || null

    // Legacy fallback check for oauth_token in query params
    useEffect(() => {
        const oauthToken = params.get('oauth_token')
        const oauthUser = params.get('oauth_user')
        if (oauthToken && oauthUser) {
            try {
                const userObj = JSON.parse(decodeURIComponent(oauthUser))
                setWarehouseRequestUser(userObj, oauthToken)
                // clean up url
                window.history.replaceState({}, document.title, location.pathname)
                checkRequestStatus(userObj.email)
            } catch (e) {
                console.error('Failed to parse oauth auth in WarehouseRequest:', e)
            }
        }
    }, [params, setWarehouseRequestUser, location.pathname])

    const handleGoogleLogin = () => {
        setGoogleLoading(true)
        window.location.href = `${API_BASE_URL.replace(/\/api\/?$/, '')}/partner/login/google?flow=warehouse_request`
    }

    const checkRequestStatus = async (emailToCheck) => {
        if (!emailToCheck) { setStatusData(null); return }
        setLoadingStatus(true)
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/request-status?email=${encodeURIComponent(emailToCheck)}`)
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Could not fetch request status.')
            setStatusData(data)
            if (data.verification_status === 'pending') setShowWaitingModal(true)
        } catch (statusError) {
            setError(statusError.message || 'Could not fetch request status.')
        } finally {
            setLoadingStatus(false)
        }
    }

    useEffect(() => {
        const oauthToken = params.get('oauth_token')
        const oauthUser = params.get('oauth_user')
        if (!oauthToken || !oauthUser) return
        try {
            const requestUser = JSON.parse(decodeURIComponent(oauthUser))
            setWarehouseRequestUser(requestUser, oauthToken)
            navigate('/warehouse/request', { replace: true })
        } catch {
            setError('Google verification failed. Please try again.')
        }
    }, [navigate, params, setWarehouseRequestUser])

    useEffect(() => {
        if (!warehouseRequestUser) return
        setFormData((prev) => ({
            ...prev,
            owner_name: prev.owner_name || warehouseRequestUser.name || '',
            email: warehouseRequestUser.email || prev.email,
        }))
    }, [warehouseRequestUser])

    useEffect(() => {
        if (!warehouseRequestUser?.email) return
        checkRequestStatus(warehouseRequestUser.email)
    }, [warehouseRequestUser?.email])

    useEffect(() => {
        if (!application || currentStatus !== 'rejected') return
        setFormData((prev) => ({
            ...prev,
            warehouse_name: application.warehouse_name || prev.warehouse_name,
            owner_name: application.owner_name || prev.owner_name,
            email: application.email || prev.email,
            phone: application.phone || prev.phone,
            address: application.address || prev.address,
            pincode: application.pincode || prev.pincode,
            warehouse_capacity: String(application.warehouse_capacity ?? prev.warehouse_capacity ?? ''),
            warehouse_type: application.warehouse_type || prev.warehouse_type,
        }))
    }, [application, currentStatus])

    const handleInputChange = (e) => {
        const { name, value } = e.target
        setFormData((prev) => ({ ...prev, [name]: value }))
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(''); setSuccessMessage('')
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Warehouse request could not be submitted.')
            setSuccessMessage(data.message || 'Warehouse request submitted successfully.')
            await checkRequestStatus(formData.email)
        } catch (submitError) {
            setError(submitError.message || 'Warehouse request could not be submitted.')
        } finally {
            setSubmitting(false)
        }
    }

    // ── Status panel ──────────────────────────────────────────────────────────
    const StatusPanel = () => {
        if (loadingStatus) return (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px', color: '#94a3b8', fontSize: '14px' }}>
                Checking your request status...
            </div>
        )
        if (currentStatus === 'approved') return (
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <CheckCircle2 size={20} style={{ color: '#34d399', flexShrink: 0 }} />
                    <div>
                        <p style={{ fontWeight: 700, color: '#34d399', fontSize: '13px', marginBottom: '6px' }}>Approved</p>
                        <p style={{ color: '#a7f3d0', fontSize: '14px', marginBottom: '14px' }}>Your warehouse request is approved. You can now log in.</p>
                        <Link to="/warehouse/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#34d399', color: '#0f172a', padding: '10px 18px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}>
                            Go to warehouse login <ArrowRight size={14} />
                        </Link>
                    </div>
                </div>
            </div>
        )
        if (currentStatus === 'pending') return (
            <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <Clock3 size={20} style={{ color: '#fbbf24', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 700, color: '#fbbf24', fontSize: '13px', marginBottom: '6px' }}>Pending review</p>
                        <p style={{ color: '#fde68a', fontSize: '14px', marginBottom: '14px' }}>Admin approval is still pending. The form remains locked.</p>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button onClick={() => setShowWaitingModal(true)} style={{ background: '#fbbf24', border: 'none', color: '#0f172a', padding: '10px 16px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                                View request details
                            </button>
                            <button onClick={() => checkRequestStatus(warehouseRequestUser?.email)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9', padding: '10px 16px', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <RefreshCw size={12} /> Refresh status
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )
        if (currentStatus === 'rejected') return (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <XCircle size={20} style={{ color: '#f87171', flexShrink: 0 }} />
                    <div>
                        <p style={{ fontWeight: 700, color: '#f87171', fontSize: '13px', marginBottom: '6px' }}>Needs changes</p>
                        <p style={{ color: '#fca5a5', fontSize: '14px', marginBottom: application?.admin_notes ? '12px' : 0 }}>You can correct the details below and resubmit.</p>
                        {application?.admin_notes && (
                            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px', fontSize: '13px', color: '#e2e8f0' }}>
                                Admin note: {application.admin_notes}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )
        return (
            <div style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <UserRoundCheck size={20} style={{ color: '#5eead4', flexShrink: 0 }} />
                    <div>
                        <p style={{ fontWeight: 700, color: '#5eead4', fontSize: '13px', marginBottom: '6px' }}>Ready to request</p>
                        <p style={{ color: '#a7f3d0', fontSize: '14px' }}>Your Google account is verified. Fill the warehouse details and submit.</p>
                    </div>
                </div>
            </div>
        )
    }

    // ── Page ──────────────────────────────────────────────────────────────────
    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
            padding: '24px 16px',
            fontFamily: "'Inter', sans-serif",
            color: '#f1f5f9',
        }}>
            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>

                {/* Header */}
                <div style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '20px', padding: '24px 28px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexWrap: 'wrap', gap: '16px', marginBottom: '24px',
                }}>
                    <div>
                        <div style={{ ...s.chip('20,184,166'), marginBottom: '12px' }}>
                            <FileText size={12} /> Warehouse access request
                        </div>
                        <h1 style={{ fontSize: '24px', fontWeight: 900, fontFamily: "'Manrope',sans-serif", margin: 0 }}>
                            Request warehouse onboarding
                        </h1>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <Link to="/warehouse/login" style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#cbd5e1', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>
                            Back to login
                        </Link>
                        <Link to="/" style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#cbd5e1', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>
                            Back to home
                        </Link>
                    </div>
                </div>

                {/* Step 1: Not yet OAuth verified */}
                {!warehouseRequestUser ? (
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: '24px',
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '20px', padding: '36px 28px',
                    }}>
                        <div>
                            <p style={{ ...s.chip('20,184,166'), marginBottom: '16px' }}>Step 1</p>
                            <h2 style={{ fontSize: '22px', fontWeight: 900, fontFamily: "'Manrope',sans-serif", marginBottom: '14px' }}>
                                Verify your Google account first
                            </h2>
                            <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '24px' }}>
                                The request page is locked until the applicant verifies the Google account that will be used for warehouse access. After verification, the signup form appears automatically.
                            </p>
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                <button onClick={handleGoogleLogin} disabled={googleLoading} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                                    background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                    color: '#fff', padding: '14px 22px', borderRadius: '12px',
                                    border: 'none', fontWeight: 700, fontSize: '14px',
                                    boxShadow: '0 4px 16px rgba(20,184,166,0.3)',
                                    cursor: googleLoading ? 'not-allowed' : 'pointer',
                                    opacity: googleLoading ? 0.7 : 1,
                                    fontFamily: "'Inter', sans-serif",
                                }}>
                                    {googleLoading ? 'Verifying...' : 'Continue with Google'} <ArrowRight size={15} />
                                </button>
                                <Link to="/warehouse/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1', padding: '14px 22px', borderRadius: '12px', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }}>
                                    Already approved? Login
                                </Link>
                            </div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '24px' }}>
                            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569', marginBottom: '16px' }}>Approval gate</p>
                            {[
                                { icon: ShieldCheck, color: '#5eead4', text: 'Google account must be verified first.' },
                                { icon: Clock3, color: '#fbbf24', text: 'Pending requests stay locked until admin approval.' },
                                { icon: AlertTriangle, color: '#f87171', text: 'Rejected requests can be corrected and resubmitted.' },
                            ].map(({ icon, color, text }) => (
                                <div key={text} style={{ display: 'flex', gap: '10px', marginBottom: '14px', alignItems: 'flex-start' }}>
                                    {icon === ShieldCheck && <ShieldCheck size={16} style={{ color, flexShrink: 0, marginTop: '2px' }} />}
                                    {icon === Clock3 && <Clock3 size={16} style={{ color, flexShrink: 0, marginTop: '2px' }} />}
                                    {icon === AlertTriangle && <AlertTriangle size={16} style={{ color, flexShrink: 0, marginTop: '2px' }} />}
                                    <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>{text}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Step 2: OAuth verified — show form */
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
                        {/* Left: status */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '18px', padding: '24px' }}>
                                <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', marginBottom: '10px' }}>Verified applicant</p>
                                <p style={{ fontWeight: 800, fontSize: '18px', fontFamily: "'Manrope',sans-serif", marginBottom: '4px' }}>{warehouseRequestUser.name || 'Warehouse applicant'}</p>
                                <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>{warehouseRequestUser.email}</p>
                                <button onClick={() => checkRequestStatus(warehouseRequestUser.email)} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#cbd5e1', padding: '10px 16px', borderRadius: '10px',
                                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                                }}>
                                    <RefreshCw size={13} className={loadingStatus ? 'animate-spin' : ''} />
                                    Refresh status
                                </button>
                            </div>
                            <StatusPanel />
                        </div>

                        {/* Right: form */}
                        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '18px', padding: '28px' }}>
                            <h2 style={{ fontSize: '22px', fontWeight: 900, fontFamily: "'Manrope',sans-serif", marginBottom: '8px' }}>Warehouse request details</h2>
                            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', lineHeight: 1.5 }}>
                                The form is available only when there is no pending or approved request.
                            </p>

                            {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '12px 16px', fontSize: '13px', color: '#fca5a5', marginBottom: '16px' }}>{error}</div>}
                            {successMessage && <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '12px', padding: '12px 16px', fontSize: '13px', color: '#6ee7b7', marginBottom: '16px' }}>{successMessage}</div>}

                            {currentStatus === 'pending' || currentStatus === 'approved' ? (
                                <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: '14px', padding: '32px', textAlign: 'center' }}>
                                    <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569', marginBottom: '10px' }}>Form locked</p>
                                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#94a3b8' }}>
                                        {currentStatus === 'pending' ? 'Waiting for admin approval.' : 'Already approved — use warehouse login.'}
                                    </p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                        {[
                                            { name: 'warehouse_name', label: 'Warehouse name', placeholder: 'JDLX East Hub' },
                                            { name: 'owner_name', label: 'Owner name', placeholder: 'Full name' },
                                            { name: 'email', label: 'Email', placeholder: 'verified@email.com', type: 'email', readOnly: Boolean(warehouseRequestUser?.email) },
                                            { name: 'phone', label: 'Phone', placeholder: '+91 9XXXXXXXXX' },
                                            { name: 'pincode', label: 'Pincode', placeholder: '700001' },
                                            { name: 'warehouse_capacity', label: 'Capacity (sq ft)', placeholder: '2000', type: 'number' },
                                        ].map(({ name, label, placeholder, type = 'text', readOnly }) => (
                                            <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <label style={s.label}>{label}</label>
                                                <input
                                                    name={name} type={type}
                                                    value={formData[name]}
                                                    onChange={handleInputChange}
                                                    placeholder={placeholder}
                                                    readOnly={readOnly}
                                                    required={name !== 'warehouse_capacity'}
                                                    style={{ ...s.input, opacity: readOnly ? 0.6 : 1 }}
                                                />
                                            </div>
                                        ))}
                                        <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={s.label}>Address</label>
                                            <textarea name="address" value={formData.address} onChange={handleInputChange} rows={3} required placeholder="Complete warehouse address" style={{ ...s.input, resize: 'vertical' }} />
                                        </div>
                                        <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <label style={s.label}>Warehouse type</label>
                                            <select name="warehouse_type" value={formData.warehouse_type} onChange={handleInputChange} required style={s.input}>
                                                {WAREHOUSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
                                        <button type="submit" disabled={submitting || loadingStatus} style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '8px',
                                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                            color: '#fff', padding: '14px 22px', borderRadius: '12px',
                                            border: 'none', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                                            opacity: (submitting || loadingStatus) ? 0.6 : 1,
                                        }}>
                                            {submitting ? 'Submitting...' : 'Submit warehouse request'}
                                            <ArrowRight size={15} />
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <WaitingModal
                open={showWaitingModal && currentStatus === 'pending'}
                onClose={() => setShowWaitingModal(false)}
                application={application}
            />
        </div>
    )
}

export default WarehouseRequest
