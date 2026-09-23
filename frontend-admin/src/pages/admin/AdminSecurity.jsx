import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'
import { Loader2, Mail, Smartphone, ShieldCheck, ShieldQuestion, Lock, Eye, EyeOff, KeyRound, UserCog, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

// Must match the backend SECURITY_QUESTIONS list.
const SECURITY_QUESTIONS = [
    "What was the name of your first school?",
    "What is your mother's maiden name?",
    "What was the make of your first car/bike?",
    "What is the name of the street you grew up on?",
    "What was your childhood nickname?",
]

const AdminSecurity = () => {
    const adminUser = useStore(state => state.adminUser)
    const setAdminUser = useStore(state => state.setAdminUser)

    const [status, setStatus] = useState(null)
    const [loading, setLoading] = useState(true)

    // Profile (email / phone) form
    const [newEmail, setNewEmail] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [profileAnswer, setProfileAnswer] = useState('')
    const [profileSaving, setProfileSaving] = useState(false)

    // Security question form
    const [sqQuestion, setSqQuestion] = useState(SECURITY_QUESTIONS[0])
    const [sqAnswer, setSqAnswer] = useState('')
    const [sqCurrentAnswer, setSqCurrentAnswer] = useState('')
    const [sqSaving, setSqSaving] = useState(false)

    // Password change form
    const [pwCurrent, setPwCurrent] = useState('')
    const [pwNew, setPwNew] = useState('')
    const [pwConfirm, setPwConfirm] = useState('')
    const [pwAnswer, setPwAnswer] = useState('')
    const [pwSaving, setPwSaving] = useState(false)
    const [showPw, setShowPw] = useState(false)

    const loadStatus = useCallback(async () => {
        setLoading(true)
        try {
            const res = await apiFetch('/admin/security/status', { skipGlobalError: true })
            if (res.status === 401) return
            const data = await res.json()
            if (data.success) {
                setStatus(data.data)
                setNewEmail(data.data?.email || '')
                setNewPhone(data.data?.admin_phone || '')
                setSqQuestion(data.data?.security_question || SECURITY_QUESTIONS[0])
            }
        } catch {
            toast.error('Could not load security status')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadStatus()
    }, [loadStatus])

    // ---------------- Profile update (email / mobile) ----------------
    const handleProfileSave = async (e) => {
        e.preventDefault()
        const emailChanged = newEmail.trim() && newEmail.trim().toLowerCase() !== (status?.email || '').toLowerCase()
        const phoneChanged = (newPhone.trim() || '') !== (status?.admin_phone || '')
        if (!emailChanged && !phoneChanged) {
            toast.error('No changes to save')
            return
        }
        if (!profileAnswer.trim()) {
            toast.error('Security answer is required to update login details')
            return
        }
        setProfileSaving(true)
        try {
            const res = await apiFetch('/admin/security/update-profile', {
                method: 'POST',
                body: JSON.stringify({
                    email: emailChanged ? newEmail.trim() : '',
                    admin_phone: phoneChanged ? newPhone.trim() : '',
                    security_answer: profileAnswer.trim()
                }),
                skipGlobalError: true
            })
            const data = await res.json()
            if (data.success) {
                setAdminUser(data.data?.user)
                toast.success('Login details updated successfully')
                setProfileAnswer('')
                await loadStatus()
            } else {
                toast.error(data.error || 'Update failed')
            }
        } catch {
            toast.error('Network error. Try again.')
        } finally {
            setProfileSaving(false)
        }
    }

    // ---------------- Security question setup ----------------
    const handleSecurityQuestionSave = async (e) => {
        e.preventDefault()
        if (!sqAnswer.trim()) {
            toast.error('Please provide the answer')
            return
        }
        if (status?.has_security_question && !sqCurrentAnswer.trim()) {
            toast.error('Enter your CURRENT security answer to replace the question')
            return
        }
        setSqSaving(true)
        try {
            const res = await apiFetch('/admin/security/setup', {
                method: 'POST',
                body: JSON.stringify({
                    security_question: sqQuestion,
                    security_answer: sqAnswer.trim(),
                    current_answer: status?.has_security_question ? sqCurrentAnswer.trim() : ''
                }),
                skipGlobalError: true
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Security question saved')
                setSqAnswer('')
                setSqCurrentAnswer('')
                await loadStatus()
            } else {
                toast.error(data.error || 'Could not save security question')
            }
        } catch {
            toast.error('Network error. Try again.')
        } finally {
            setSqSaving(false)
        }
    }

    // ---------------- Password change ----------------
    const handlePasswordChange = async (e) => {
        e.preventDefault()
        if (!pwNew || pwNew.length < 8) {
            toast.error('New password must be at least 8 characters')
            return
        }
        if (!/[A-Za-z]/.test(pwNew) || !/\d/.test(pwNew)) {
            toast.error('Password must contain both letters and numbers')
            return
        }
        if (pwNew !== pwConfirm) {
            toast.error('Passwords do not match')
            return
        }
        if (!pwAnswer.trim()) {
            toast.error('Security answer is required to change the password')
            return
        }
        if (!status?.has_password) {
            toast.error('Set up password recovery first: save your security question, then use Forgot Password on the login page.')
            return
        }
        setPwSaving(true)
        try {
            const res = await apiFetch('/admin/security/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    current_password: pwCurrent,
                    new_password: pwNew,
                    security_answer: pwAnswer.trim()
                }),
                skipGlobalError: true
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Password changed successfully')
                setPwCurrent('')
                setPwNew('')
                setPwConfirm('')
                setPwAnswer('')
            } else {
                toast.error(data.error || 'Password change failed')
            }
        } catch {
            toast.error('Network error. Try again.')
        } finally {
            setPwSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
        )
    }

    const inputCls = "w-full bg-slate-50 border-2 border-slate-100 px-4 py-3 rounded-2xl text-sm font-bold text-slate-900 focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-300"
    const labelCls = "block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1"

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Header */}
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center">
                    <ShieldCheck className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Account & Security</h1>
                    <p className="text-sm text-gray-500">Manage your login email, mobile, security key and password.</p>
                </div>
            </div>

            {/* Recovery status banner */}
            {(!status?.has_security_question || !status?.has_password) && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm font-bold text-amber-700">
                        {!status?.has_security_question && !status?.has_password && (
                            <>Set up your <b>security question</b> below, then create a <b>password</b> via "Forgot Password" on the login page to enable password login.</>
                        )}
                        {!status?.has_security_question && status?.has_password && (
                            <>Your <b>security question</b> is not set. Without it you cannot recover your account or change your password.</>
                        )}
                        {status?.has_security_question && !status?.has_password && (
                            <>Password login is not enabled yet. After saving your security question, log out and use <b>"Forgot Password"</b> on the login page to set your password.</>
                        )}
                    </div>
                </div>
            )}

            {/* 1. Profile: login email + mobile */}
            <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <UserCog className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                        <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">Login Details</h2>
                        <p className="text-xs text-gray-500">Update the email or mobile you use to sign in.</p>
                    </div>
                </div>

                <form onSubmit={handleProfileSave} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Login Email</label>
                            <div className="relative">
                                <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="admin@jdlx.com" className={`${inputCls} pl-10`} />
                            </div>
                        </div>
                        <div>
                            <label className={labelCls}>Login Mobile</label>
                            <div className="relative">
                                <Smartphone size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="9876543210" className={`${inputCls} pl-10`} />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className={labelCls}>Security Answer (required)</label>
                        <input type="password" value={profileAnswer} onChange={(e) => setProfileAnswer(e.target.value)} placeholder="Answer your security question to confirm" autoComplete="off" className={inputCls} />
                    </div>
                    <button type="submit" disabled={profileSaving} className="h-11 px-6 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 active:scale-95">
                        {profileSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        Save Login Details
                    </button>
                </form>
            </section>

            {/* 2. Security question (the "security key") */}
            <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <ShieldQuestion className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                        <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">Security Question</h2>
                        <p className="text-xs text-gray-500">Your account recovery key — required for password changes and login-detail updates.</p>
                    </div>
                    {status?.has_security_question && (
                        <span className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                            <ShieldCheck size={11} /> Active
                        </span>
                    )}
                </div>

                <form onSubmit={handleSecurityQuestionSave} className="space-y-4">
                    <div>
                        <label className={labelCls}>Choose Question</label>
                        <select value={sqQuestion} onChange={(e) => setSqQuestion(e.target.value)} className={inputCls}>
                            {SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>{status?.has_security_question ? 'New Answer' : 'Your Answer'}</label>
                        <input type="password" value={sqAnswer} onChange={(e) => setSqAnswer(e.target.value)} placeholder="Secret answer (stored hashed)" autoComplete="off" className={inputCls} />
                    </div>
                    {status?.has_security_question && (
                        <div>
                            <label className={labelCls}>Current Answer (to replace)</label>
                            <input type="password" value={sqCurrentAnswer} onChange={(e) => setSqCurrentAnswer(e.target.value)} placeholder="Answer the existing question first" autoComplete="off" className={inputCls} />
                        </div>
                    )}
                    <button type="submit" disabled={sqSaving} className="h-11 px-6 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 active:scale-95">
                        {sqSaving ? <Loader2 size={14} className="animate-spin" /> : <ShieldQuestion size={14} />}
                        {status?.has_security_question ? 'Replace Security Question' : 'Save Security Question'}
                    </button>
                </form>
            </section>

            {/* 3. Password change */}
            <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                        <KeyRound className="w-5 h-5 text-rose-500" />
                    </div>
                    <div>
                        <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">Change Password</h2>
                        <p className="text-xs text-gray-500">Requires your current password AND security answer.</p>
                    </div>
                    {status?.has_password && (
                        <span className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                            <Lock size={11} /> Set
                        </span>
                    )}
                </div>

                <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div>
                        <label className={labelCls}>Current Password</label>
                        <div className="relative">
                            <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type={showPw ? 'text' : 'password'} value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} placeholder={status?.has_password ? 'Current password' : 'No password set yet'} disabled={!status?.has_password} autoComplete="current-password" className={`${inputCls} pl-10 disabled:bg-slate-100 disabled:text-slate-400`} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>New Password</label>
                            <div className="relative">
                                <input type={showPw ? 'text' : 'password'} value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder="Min 8 chars, letters + numbers" autoComplete="new-password" className={`${inputCls} pr-10`} />
                                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabIndex={-1} aria-label="Toggle password visibility">
                                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className={labelCls}>Confirm New Password</label>
                            <input type={showPw ? 'text' : 'password'} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" className={inputCls} />
                        </div>
                    </div>
                    <div>
                        <label className={labelCls}>Security Answer (required)</label>
                        <input type="password" value={pwAnswer} onChange={(e) => setPwAnswer(e.target.value)} placeholder="Answer your security question to authorize" autoComplete="off" className={inputCls} />
                    </div>
                    <button type="submit" disabled={pwSaving || !status?.has_password} className="h-11 px-6 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 active:scale-95">
                        {pwSaving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                        Change Password
                    </button>
                </form>
            </section>
        </div>
    )
}

export default AdminSecurity
