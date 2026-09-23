import { useState } from 'react'
import { ShieldCheck, Loader2, X, RefreshCw, Info } from 'lucide-react'
import { apiFetch } from '../utils/apiFetch'

/**
 * Manual (self) delivery with customer OTP verification.
 *
 * Two-step guarded flow for PACKED orders:
 *  1. Start  -> server generates a 6-digit code, notifies the customer's app
 *               (the code is shown on their order tracking page; it is never
 *               shown in this panel).
 *  2. Verify -> manager reads the code back from the customer at the door;
 *               on success the order is marked DELIVERED (same terminal side
 *               effects as the admin flow).
 */
const ManualDeliveryModal = ({ assignmentId, orderNumber, onClose, onCompleted }) => {
    const [stage, setStage] = useState('confirm') // confirm | code | verifying
    const [code, setCode] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [reshared, setReshared] = useState(false)

    const startChallenge = async () => {
        setBusy(true)
        setError('')
        try {
            const response = await apiFetch(`/warehouse/orders/${assignmentId}/manual-delivery/start`, {
                method: 'POST',
                skipGlobalError: true,
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(result.error || result.message || 'Could not start manual delivery')
            setStage('code')
        } catch (err) {
            setError(err.message || 'Network error — please try again')
        } finally {
            setBusy(false)
        }
    }

    const resendNudge = async () => {
        setBusy(true)
        setError('')
        try {
            const response = await apiFetch(`/warehouse/orders/${assignmentId}/manual-delivery/start`, {
                method: 'POST',
                skipGlobalError: true,
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(result.error || result.message || 'Could not resend')
            setReshared(true)
            setTimeout(() => setReshared(false), 3000)
        } catch (err) {
            setError(err.message || 'Network error — please try again')
        } finally {
            setBusy(false)
        }
    }

    const verifyCode = async () => {
        if (!/^\d{6}$/.test(code)) {
            setError('Enter the 6-digit code the customer reads out')
            return
        }
        setBusy(true)
        setError('')
        setStage('verifying')
        try {
            const response = await apiFetch(`/warehouse/orders/${assignmentId}/manual-delivery/verify`, {
                method: 'POST',
                body: JSON.stringify({ code }),
                skipGlobalError: true,
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok) {
                setStage('code')
                setCode('')
                throw new Error(result.error || result.message || 'Verification failed')
            }
            onCompleted?.()
        } catch (err) {
            setError(err.message || 'Network error — please try again')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
                            <ShieldCheck size={22} className="text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="text-base font-black text-white tracking-tight">Manual Delivery</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                {orderNumber ? `Order ${orderNumber}` : `Assignment #${assignmentId}`}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-6 flex flex-col gap-4">
                    {error && (
                        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] font-bold text-rose-300">
                            {error}
                        </div>
                    )}

                    {stage === 'confirm' && (
                        <>
                            <div className="flex flex-col gap-2 text-[12px] font-bold text-slate-300 leading-relaxed">
                                <p>1. We'll send a 6-digit <span className="text-emerald-400">delivery code</span> to the customer's app (shown on their order tracking page).</p>
                                <p>2. Hand over the package and ask the customer to read the code out.</p>
                                <p>3. Enter it below — only then the order is marked <span className="text-emerald-400">Delivered</span>.</p>
                            </div>
                            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                <p className="text-[10px] font-bold text-amber-300/90">
                                    You can never see the code yourself — only the customer can. Do not hand over the package before verifying.
                                </p>
                            </div>
                            <button
                                onClick={startChallenge}
                                disabled={busy}
                                className="mt-1 h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                                Send Code to Customer
                            </button>
                        </>
                    )}

                    {stage === 'code' && (
                        <>
                            <p className="text-[12px] font-bold text-slate-300 leading-relaxed">
                                Code sent to the customer's app. Ask them to open the order from
                                <span className="text-emerald-400"> My Orders </span>
                                and read out the 6-digit code.
                            </p>
                            <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="••••••"
                                autoFocus
                                className="w-full h-16 rounded-2xl bg-slate-950/60 border border-white/10 text-center text-3xl font-black tracking-[0.4em] text-white placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/50"
                            />
                            {reshared && (
                                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest text-center">
                                    Reminder sent to the customer's app
                                </p>
                            )}
                            <button
                                onClick={verifyCode}
                                disabled={busy || code.length !== 6}
                                className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2Fallback />}
                                Verify &amp; Mark Delivered
                            </button>
                            <button
                                onClick={resendNudge}
                                disabled={busy}
                                className="h-10 rounded-xl text-slate-400 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <RefreshCw size={12} /> Resend reminder to customer
                            </button>
                        </>
                    )}

                    {stage === 'verifying' && (
                        <div className="flex flex-col items-center gap-4 py-6">
                            <Loader2 size={36} className="text-emerald-400 animate-spin" />
                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Verifying code…</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// Tiny inline icon to avoid another import at the top of the file.
const CheckCircle2Fallback = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <path d="m9 11 3 3L22 4" />
    </svg>
)

export default ManualDeliveryModal
