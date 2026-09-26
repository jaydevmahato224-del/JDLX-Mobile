import { useState, useEffect, useCallback } from 'react'
import {
    Undo2, Search, Loader2, PackageCheck, Truck, ShieldCheck, XCircle,
    CheckCircle2, RefreshCcw, Repeat, IndianRupee, ChevronDown, ChevronUp,
    Phone, MapPin, AlertTriangle, Clock, Copy
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'

/**
 * Returns & Complaints — the warehouse-side post-delivery pipeline.
 *
 * Flow (matches backend/warehouse_returns.py):
 *   pending_decision   → Decide: Accept Return / Accept Exchange / Refund only / Reject
 *   ready_for_pickup   → Trigger Pickup (generates the customer code) → Confirm Picked Up
 *   picked_up          → Verify item (pass/fail)
 *   verified exchange  → Pick replacement product → Dispatch replacement (new order)
 *   verified return    → Trigger Refund (admin executes the wallet payout)
 */

const STAGE_TABS = [
    { key: 'open', label: 'Open' },
    { key: 'pending', label: 'New Requests' },
    { key: 'closed', label: 'Closed' },
]

const DECISION_META = {
    'accept-return': { label: 'Return', tone: 'text-blue-700 bg-blue-50 border-blue-200' },
    'accept-exchange': { label: 'Exchange', tone: 'text-violet-700 bg-violet-50 border-violet-200' },
    'refund-only': { label: 'Refund only', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
    'reject': { label: 'Rejected', tone: 'text-red-700 bg-red-50 border-red-200' },
}

const ACTION_LABEL = { return: 'Return', exchange: 'Exchange' }

function toneForStatus(status) {
    const s = (status || '').toLowerCase()
    if (['pending'].includes(s)) return 'bg-amber-50 text-amber-700 border-amber-200'
    if (['approved', 'pickup scheduled', 'picked up', 'in review', 'exchange pending'].includes(s))
        return 'bg-blue-50 text-blue-700 border-blue-200'
    if (['refund requested'].includes(s)) return 'bg-violet-50 text-violet-700 border-violet-200'
    if (['resolved'].includes(s)) return 'bg-green-50 text-green-700 border-green-200'
    if (['rejected', 'cancelled'].includes(s)) return 'bg-red-50 text-red-600 border-red-200'
    return 'bg-slate-100 text-slate-600 border-slate-200'
}

const WarehouseReturns = () => {
    const { warehouseLogout } = useStore()
    const [items, setItems] = useState([])
    const [counts, setCounts] = useState({ pending: 0, open: 0, closed: 0 })
    const [loading, setLoading] = useState(true)
    const [stage, setStage] = useState('open')
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedId, setExpandedId] = useState(null)
    const [busyId, setBusyId] = useState(null)
    const [notification, setNotification] = useState(null)
    const [decisionNotes, setDecisionNotes] = useState({})
    const [verifyNotes, setVerifyNotes] = useState({})
    const [exchangeProduct, setExchangeProduct] = useState({})
    const [inventory, setInventory] = useState([])

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type })
        setTimeout(() => setNotification(null), 3200)
    }

    const fetchRequests = useCallback(async () => {
        setLoading(true)
        try {
            const res = await apiFetch(`/warehouse/returns?stage=${stage}&limit=100`)
            if (res.status === 401 || res.status === 403) { warehouseLogout(); return }
            if (!res.ok) throw new Error('Failed to load returns')
            const payload = await res.json()
            setItems(payload.data?.items || [])
            if (payload.data?.counts) setCounts(payload.data.counts)
        } catch (err) {
            showNotification(err.message || 'Network error', 'error')
        } finally {
            setLoading(false)
        }
    }, [stage, warehouseLogout])

    const fetchInventory = useCallback(async () => {
        try {
            const res = await apiFetch('/warehouse/inventory?limit=200')
            if (!res.ok) return
            const payload = await res.json()
            setInventory(payload.data || [])
        } catch { /* replacement picker is optional; silent */ }
    }, [])

    useEffect(() => { fetchRequests() }, [fetchRequests])
    useEffect(() => { fetchInventory() }, [fetchInventory])

    const call = async (path, body = {}, method = 'POST') => {
        setBusyId(path)
        try {
            const res = await apiFetch(path, {
                method,
                body: JSON.stringify(body),
                skipGlobalError: true, // operator must read the error and retry inline
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || data.message || 'Action failed')
            return data
        } finally {
            setBusyId(null)
        }
    }

    const withRefresh = async (fn, successMsg) => {
        try {
            await fn()
            if (successMsg) showNotification(successMsg)
            await fetchRequests()
        } catch (err) {
            showNotification(err.message || 'Network error — please try again', 'error')
        }
    }

    // ── Actions ──────────────────────────────────────────────────────────
    const decide = (c, decision) => withRefresh(
        () => call(`/warehouse/returns/${c.id}/decision`, { decision, notes: decisionNotes[c.id] || '' }),
        decision === 'reject' ? 'Request rejected' : `Request ${DECISION_META[decision].label.toLowerCase()}d`
    )

    const triggerPickup = (c) => withRefresh(
        () => call(`/warehouse/returns/${c.id}/pickup`, { courier: 'Self pickup' }),
        'Pickup triggered — customer has been notified with the code'
    )

    const confirmPickup = (c) => withRefresh(
        () => call(`/warehouse/returns/${c.id}/pickup/confirm`, {}),
        'Marked as picked up'
    )

    const verify = (c, passed) => withRefresh(
        () => call(`/warehouse/returns/${c.id}/verify`, { passed, notes: verifyNotes[c.id] || '' }),
        passed ? 'Item verified' : 'Verification failure recorded'
    )

    const dispatchExchange = (c) => withRefresh(
        () => call(`/warehouse/returns/${c.id}/exchange-dispatch`, { product_id: exchangeProduct[c.id] }),
        'Replacement order created — dispatch it from the Orders page'
    )

    const triggerRefund = (c) => withRefresh(
        () => call(`/warehouse/returns/${c.id}/refund`, {}),
        'Refund raised — admin will credit the wallet'
    )

    const copyCode = (code) => {
        navigator.clipboard?.writeText(String(code)).catch(() => {})
        showNotification(`Pickup code ${code} copied`)
    }

    // ── Derived ──────────────────────────────────────────────────────────
    const filtered = items.filter(c => {
        const q = searchQuery.toLowerCase()
        if (!q) return true
        return (
            String(c.order_id).includes(q) ||
            (c.order_number || '').toLowerCase().includes(q) ||
            (c.customer_name || '').toLowerCase().includes(q) ||
            (c.product_names || '').toLowerCase().includes(q)
        )
    })

    const replacementOptions = (c) => {
        const term = (exchangeProduct[`${c.id}__search`] || '').toLowerCase()
        return inventory
            .filter(i => (i.product_name || '').toLowerCase().includes(term))
            .slice(0, 8)
    }

    // ── Row renderer ─────────────────────────────────────────────────────
    const RequestCard = ({ c }) => {
        const open = expandedId === c.id
        const ret = c.returns || {}
        const stageKey = c.stage
        const decision = c.decision || ret.decision

        return (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                {/* Header */}
                <button
                    className="w-full text-left p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors"
                    onClick={() => setExpandedId(open ? null : c.id)}
                >
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-sm font-black text-slate-900">#{c.order_number || c.order_id}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${toneForStatus(c.status)}`}>
                                {c.status}
                            </span>
                            {decision && DECISION_META[decision] && (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${DECISION_META[decision].tone}`}>
                                    {DECISION_META[decision].label}
                                </span>
                            )}
                        </div>
                        <p className="text-sm font-bold text-slate-700 truncate">{c.issue_type}</p>
                        <p className="text-xs text-slate-500 truncate">{c.product_names || '—'}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                            <span className="flex items-center gap-1"><Clock size={11} /> {String(c.created_at || '').slice(0, 10)}</span>
                            {c.requested_action && <span>Asked: {ACTION_LABEL[c.requested_action] || c.requested_action}</span>}
                            <span className="text-slate-500 normal-case font-bold">₹{c.total_amount}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 text-slate-400">
                        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                </button>

                {open && (
                    <div className="border-t border-slate-100 p-4 pt-3 flex flex-col gap-4 bg-slate-50/60">
                        {/* Customer + issue detail */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="space-y-1">
                                <p className="flex items-center gap-1.5 text-slate-700 font-bold">
                                    <Phone size={13} className="text-slate-400" /> {c.customer_name || c.customer_name_user || 'Customer'}
                                </p>
                                <p className="flex items-start gap-1.5 text-slate-500">
                                    <MapPin size={13} className="text-slate-400 mt-0.5 shrink-0" />
                                    <span className="text-xs leading-snug">{c.delivery_address || '—'}</span>
                                </p>
                            </div>
                            <div className="bg-white border border-slate-200 rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Reported issue</p>
                                <p className="text-xs text-slate-700 whitespace-pre-wrap">{c.description}</p>
                                {c.photo_path && (
                                    <a
                                        href={c.photo_path.startsWith('http') ? c.photo_path : `${(import.meta.env.VITE_API_URL || '').replace(/\/api$/, '')}${c.photo_path}`}
                                        target="_blank" rel="noreferrer"
                                        className="mt-2 inline-block text-[11px] font-black uppercase tracking-wider text-blue-600 underline"
                                    >View evidence photo</a>
                                )}
                            </div>
                        </div>

                        {/* Pickup code banner */}
                        {ret.pickup_status === 'scheduled' && ret.pickup_code && (
                            <div className="bg-blue-600 text-white rounded-xl p-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Customer pickup code</p>
                                    <p className="text-2xl font-black tracking-[0.3em]">{ret.pickup_code}</p>
                                </div>
                                <button onClick={() => copyCode(ret.pickup_code)} className="p-2 rounded-lg bg-white/15 hover:bg-white/25 transition-colors" title="Copy code">
                                    <Copy size={16} />
                                </button>
                            </div>
                        )}

                        {/* Action area per stage */}
                        {stageKey === 'pending_decision' && (
                            <div className="flex flex-col gap-2">
                                <input
                                    value={decisionNotes[c.id] || ''}
                                    onChange={e => setDecisionNotes({ ...decisionNotes, [c.id]: e.target.value })}
                                    placeholder="Decision note (optional) — reaches the customer"
                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <button disabled={busyId === `/warehouse/returns/${c.id}/decision`}
                                        onClick={() => decide(c, 'accept-return')}
                                        className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        <Undo2 size={14} /> Accept Return
                                    </button>
                                    <button disabled={busyId === `/warehouse/returns/${c.id}/decision`}
                                        onClick={() => decide(c, 'accept-exchange')}
                                        className="py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        <Repeat size={14} /> Accept Exchange
                                    </button>
                                    <button disabled={busyId === `/warehouse/returns/${c.id}/decision`}
                                        onClick={() => decide(c, 'refund-only')}
                                        className="py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        <IndianRupee size={14} /> Refund Only
                                    </button>
                                    <button disabled={busyId === `/warehouse/returns/${c.id}/decision`}
                                        onClick={() => decide(c, 'reject')}
                                        className="py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        <XCircle size={14} /> Reject
                                    </button>
                                </div>
                            </div>
                        )}

                        {stageKey === 'ready_for_pickup' && decision !== 'reject' && (
                            <div className="flex flex-col gap-2">
                                {decision === 'refund-only' ? (
                                    <div className="flex flex-col gap-2">
                                        <p className="text-xs text-slate-500 font-bold">Refund approved without return — trigger it for the admin payout:</p>
                                        <button disabled={busyId === `/warehouse/returns/${c.id}/refund`}
                                            onClick={() => triggerRefund(c)}
                                            className="py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 w-fit px-4">
                                            <IndianRupee size={14} /> Trigger Refund
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-xs text-slate-500 font-bold">Item must come back — schedule the reverse pickup:</p>
                                        <button disabled={busyId === `/warehouse/returns/${c.id}/pickup`}
                                            onClick={() => triggerPickup(c)}
                                            className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 w-fit px-4">
                                            <Truck size={14} /> Trigger Pickup
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {stageKey === 'pickup_scheduled' && (
                            <button disabled={busyId === `/warehouse/returns/${c.id}/pickup/confirm`}
                                onClick={() => confirmPickup(c)}
                                className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 w-fit px-4">
                                <PackageCheck size={14} /> Confirm Picked Up
                            </button>
                        )}

                        {stageKey === 'picked_up' && (
                            <div className="flex flex-col gap-2">
                                <input
                                    value={verifyNotes[c.id] || ''}
                                    onChange={e => setVerifyNotes({ ...verifyNotes, [c.id]: e.target.value })}
                                    placeholder="Verification note (condition, accessories…)"
                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <div className="flex gap-2">
                                    <button disabled={busyId === `/warehouse/returns/${c.id}/verify`}
                                        onClick={() => verify(c, true)}
                                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        <ShieldCheck size={14} /> Verification Passed
                                    </button>
                                    <button disabled={busyId === `/warehouse/returns/${c.id}/verify`}
                                        onClick={() => verify(c, false)}
                                        className="py-2.5 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50">
                                        <AlertTriangle size={14} /> Failed
                                    </button>
                                </div>
                            </div>
                        )}

                        {stageKey === 'verified' && decision === 'accept-exchange' && (
                            <div className="flex flex-col gap-2">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Replacement product</p>
                                <div className="flex flex-col gap-2">
                                    <select
                                        value={exchangeProduct[c.id] || ''}
                                        onChange={e => setExchangeProduct({ ...exchangeProduct, [c.id]: Number(e.target.value) })}
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500"
                                    >
                                        <option value="">Select replacement…</option>
                                        {replacementOptions(c).map(i => (
                                            <option key={i.id} value={i.product_id ?? i.id}>
                                                {i.product_name} {i.sku ? `(${i.sku})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        disabled={busyId === `/warehouse/returns/${c.id}/exchange-dispatch` || !exchangeProduct[c.id]}
                                        onClick={() => dispatchExchange(c)}
                                        className="py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 w-fit px-4">
                                        <Repeat size={14} /> Dispatch Replacement
                                    </button>
                                    <p className="text-[11px] text-slate-400">Creates a linked ₹0 order assigned to this warehouse — dispatch it from the Orders page (Shiprocket or manual).</p>
                                </div>
                            </div>
                        )}

                        {stageKey === 'verified' && decision !== 'accept-exchange' && (
                            <button disabled={busyId === `/warehouse/returns/${c.id}/refund`}
                                onClick={() => triggerRefund(c)}
                                className="py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50 w-fit px-4">
                                <IndianRupee size={14} /> Trigger Refund
                            </button>
                        )}

                        {stageKey === 'exchange_pending' && decision === 'accept-exchange' && (
                            <p className="text-xs font-bold text-violet-600">Verification passed — select the replacement above or reopen after verification.</p>
                        )}

                        {stageKey === 'refund_requested' && (
                            <p className="text-xs font-bold text-violet-600">Refund raised — awaiting admin wallet payout.</p>
                        )}

                        {stageKey === 'closed' && (
                            <div className="text-xs text-slate-500 space-y-1">
                                {c.resolution && <p><b>Resolution:</b> {c.resolution}</p>}
                                {ret.verification_notes && <p><b>Verification:</b> {ret.verification_notes}</p>}
                                {ret.exchange_order_id && <p><b>Replacement order:</b> #{ret.exchange_order_id}</p>}
                                {ret.refund_request_id && <p><b>Refund request:</b> #{ret.refund_request_id}</p>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="p-4 lg:p-8 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center">
                        <Undo2 size={22} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-white tracking-tight">Returns & Complaints</h1>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Customer issues • Pickup • Verify • Exchange / Refund</p>
                    </div>
                </div>
                <button onClick={fetchRequests} className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition-colors" title="Refresh">
                    <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {notification && (
                <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-bold ${notification.type === 'error' ? 'bg-red-500/15 text-red-300 border border-red-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}`}>
                    {notification.message}
                </div>
            )}

            {/* Tabs + search */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
                {STAGE_TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setStage(t.key)}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-colors ${
                            stage === t.key ? 'bg-white text-slate-900' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                        }`}
                    >
                        {t.label}
                        {counts[t.key] > 0 && (
                            <span className={`ml-1.5 px-1.5 py-0.5 rounded-md text-[10px] ${stage === t.key ? 'bg-slate-900 text-white' : 'bg-white/10'}`}>{counts[t.key]}</span>
                        )}
                    </button>
                ))}
                <div className="relative ml-auto">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search order / customer / product"
                        className="w-64 pl-9 pr-3 py-2 text-sm bg-white/5 border border-white/10 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            </div>

            {/* List */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 size={32} className="animate-spin text-blue-400" />
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Loading requests…</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-slate-600">
                        <CheckCircle2 size={30} />
                    </div>
                    <h3 className="text-lg font-black text-slate-300">Nothing here</h3>
                    <p className="text-xs text-slate-500 max-w-xs">No requests in this stage. New customer complaints land here automatically.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(c => <RequestCard key={c.id} c={c} />)}
                </div>
            )}
        </div>
    )
}

export default WarehouseReturns
