import { useState, useEffect, useCallback, Fragment } from 'react'
import {
    Wallet,
    TrendingUp,
    Percent,
    Hourglass,
    CheckCircle2,
    XCircle,
    RefreshCw,
    Loader2,
    FileText,
    ArrowDownToLine,
    Building2,
    ChevronDown,
    ChevronUp,
    Clock
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import toast from 'react-hot-toast'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'

const PAYOUT_STATUS_STYLES = {
    requested: { label: 'Requested', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    paid: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rejected: { label: 'Rejected', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
}

const SETTLEMENT_STATUS_STYLES = {
    pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    settled: { label: 'Settled', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    void: { label: 'Void', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
}

const formatINR = (value) =>
    `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

const formatDate = (value) => {
    if (!value) return '—'
    try {
        return new Date(value).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
        })
    } catch {
        return value
    }
}

export default function AdminVendorPayouts() {
const adminUser = useStore(state => state.adminUser)
const isSuperAdmin = adminUser?.role?.toLowerCase() === 'super_admin'

    const [overview, setOverview] = useState(null)
    const [payouts, setPayouts] = useState([])
    const [payoutFilter, setPayoutFilter] = useState('requested')
    const [loading, setLoading] = useState(true)
    const [expandedWh, setExpandedWh] = useState(null)
    const [whSettlements, setWhSettlements] = useState({})
    const [loadingWh, setLoadingWh] = useState(null)
    const [commissionRate, setCommissionRate] = useState('')
    const [savingCommission, setSavingCommission] = useState(false)
    const [processingId, setProcessingId] = useState(null)
    const [notes, setNotes] = useState({})

    const fetchOverview = useCallback(async () => {
        try {
            const res = await apiFetch('/admin/vendor/overview')
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || json.message || 'Failed to load overview')
            setOverview(json.data)
            if (json.data?.commission_rate !== undefined) {
                setCommissionRate(String(json.data.commission_rate))
            }
        } catch (e) {
            toast.error(e.message)
        }
    }, [])

    const fetchPayouts = useCallback(async (status) => {
        try {
            const params = status ? `?status=${status}` : ''
            const res = await apiFetch(`/admin/vendor/payouts${params}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || json.message || 'Failed to load payouts')
            setPayouts(json.data || [])
        } catch (e) {
            toast.error(e.message)
        }
    }, [])

    useEffect(() => {
        setLoading(true)
        Promise.all([fetchOverview(), fetchPayouts('requested')]).finally(() => setLoading(false))
    }, [fetchOverview, fetchPayouts])

    useEffect(() => {
        fetchPayouts(payoutFilter)
    }, [payoutFilter, fetchPayouts])

    const handlePayoutDecision = async (payout, decision) => {
        let transactionRef = ''
        if (decision === 'paid') {
            transactionRef = (window.prompt(
                `Approve payout #${payout.id} (₹${payout.amount})?

Enter the bank/UPI transaction reference (UTR) — required to mark this payout as paid (6-12 alphanumeric characters):`,
                ''
            ) || '').trim()
            if (!transactionRef) {
                toast.error('Transaction reference (UTR) is required to approve a payout')
                return
            }
            if (!/^[A-Za-z0-9]{6,12}$/.test(transactionRef)) {
                toast.error('Transaction reference must be 6-12 alphanumeric characters')
                return
            }
        }
        setProcessingId(payout.id)
        try {
            const res = await apiFetch(`/admin/vendor/payouts/${payout.id}/${decision === 'paid' ? 'approve' : 'reject'}`, {
                method: 'POST',
                body: JSON.stringify({ admin_note: notes[payout.id] || '', transaction_ref: transactionRef || undefined }),
            })
            const json = await res.json()
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                toast.error(errData.message || json.message || `Failed to ${decision} payout`)
                return
            }
            toast.success(json.message || `Payout ${decision}`)
            await Promise.all([fetchOverview(), fetchPayouts(payoutFilter)])
        } catch (e) {
            toast.error(e.message)
        } finally {
            setProcessingId(null)
        }
    }

    const handleSaveCommission = async () => {
        if (!isSuperAdmin) return
        const rate = parseFloat(commissionRate)
        if (isNaN(rate) || rate < 0 || rate > 100) {
            toast.error('Enter a commission rate between 0 and 100')
            return
        }
        setSavingCommission(true)
        try {
            const res = await apiFetch('/admin/vendor/commission', {
                method: 'POST',
                body: JSON.stringify({ commission_rate: rate }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || json.message || 'Failed to save')
            toast.success(json.message || 'Commission rate updated')
            await fetchOverview()
        } catch (e) {
            toast.error(e.message)
        } finally {
            setSavingCommission(false)
        }
    }

    const toggleWarehouse = async (wh) => {
        if (expandedWh === wh.id) {
            setExpandedWh(null)
            return
        }
        setExpandedWh(wh.id)
        setLoadingWh(wh.id)
        try {
            const res = await apiFetch(`/admin/vendor/settlements?warehouse_id=${wh.id}&limit=50`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || json.message || 'Failed to load settlements')
            setWhSettlements((prev) => ({ ...prev, [wh.id]: json.data || [] }))
        } catch (e) {
            toast.error(e.message)
        } finally {
            setLoadingWh(null)
        }
    }

    const totals = overview?.totals || {}
    const statCards = [
        {
            label: 'Total Settled to Vendors',
            value: formatINR(totals.settled_amount),
            sub: `${totals.settled_count || 0} settlements completed`,
            icon: Wallet,
            iconCls: 'bg-emerald-100 text-emerald-600',
        },
        {
            label: 'Platform Commission Earned',
            value: formatINR(totals.commission_earned),
            sub: 'Your revenue from settlements',
            icon: Percent,
            iconCls: 'bg-indigo-100 text-indigo-600',
        },
        {
            label: 'Pending Settlements',
            value: formatINR(totals.pending_amount),
            sub: `${totals.pending_count || 0} orders in return window`,
            icon: Hourglass,
            iconCls: 'bg-amber-100 text-amber-600',
        },
        {
            label: 'Voided Settlements',
            value: `${totals.voided_count || 0}`,
            sub: 'Cancelled / refunded orders',
            icon: XCircle,
            iconCls: 'bg-slate-100 text-slate-600',
        },
    ]

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-3 text-slate-900">
                        <div className="p-2 bg-emerald-100 rounded-xl">
                            <Wallet className="text-emerald-600 w-6 h-6" />
                        </div>
                        Vendor Settlements &amp; Payouts
                    </h1>
                    <p className="text-slate-500 text-sm font-medium mt-1">
                        Amazon-style: customers pay the platform, warehouses are settled after the return window minus commission.
                    </p>
                </div>
                <button
                    onClick={() => { fetchOverview(); fetchPayouts(payoutFilter) }}
                    className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {loading && !overview ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="animate-spin text-emerald-600" size={28} />
                </div>
            ) : (
                <>
                    {/* Stats */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {statCards.map((card) => {
                            const Icon = card.icon
                            return (
                                <div key={card.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${card.iconCls}`}>
                                        <Icon size={18} />
                                    </div>
                                    <p className="text-2xl font-black text-slate-900">{card.value}</p>
                                    <p className="text-xs font-bold text-slate-500 mt-1">{card.label}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{card.sub}</p>
                                </div>
                            )
                        })}
                    </div>

                    {/* Commission setting */}
                    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex-1">
                            <p className="text-sm font-black text-slate-900 flex items-center gap-2">
                                <Percent size={16} className="text-indigo-600" /> Platform Commission Rate
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Uniform commission deducted from every warehouse settlement. Delivery fees are never part of settlements.
                                {!isSuperAdmin && ' (Super Admin only)'}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.5"
                                    value={commissionRate}
                                    disabled={!isSuperAdmin}
                                    onChange={(e) => setCommissionRate(e.target.value)}
                                    className="w-24 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-black text-sm focus:outline-none focus:border-indigo-400 disabled:opacity-50"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">%</span>
                            </div>
                            {isSuperAdmin && (
                                <button
                                    onClick={handleSaveCommission}
                                    disabled={savingCommission}
                                    className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {savingCommission && <Loader2 size={14} className="animate-spin" />}
                                    Save
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Payout requests */}
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                            <h2 className="font-black text-slate-900 flex items-center gap-2">
                                <ArrowDownToLine size={18} className="text-emerald-600" /> Payout Requests
                            </h2>
                            <div className="flex gap-1 text-[11px] font-bold">
                                {['requested', 'paid', 'rejected'].map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => setPayoutFilter(s)}
                                        className={`px-3 py-1.5 rounded-lg transition-colors ${
                                            payoutFilter === s ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400 hover:text-slate-700'
                                        }`}
                                    >
                                        {s.charAt(0).toUpperCase() + s.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-slate-50/70">
                                        <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Warehouse</th>
                                        <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                                        <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Requested</th>
                                        <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                        <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Note</th>
                                        <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Txn Ref</th>
                                        <th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {payouts.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="p-8 text-center text-sm text-slate-400">
                                                No {payoutFilter} payouts.
                                            </td>
                                        </tr>
                                    ) : payouts.map((p) => {
                                        const st = PAYOUT_STATUS_STYLES[p.status] || PAYOUT_STATUS_STYLES.requested
                                        return (
                                            <tr key={p.id} className="hover:bg-slate-50/50">
                                                <td className="p-4">
                                                    <p className="text-sm font-bold text-slate-900">{p.warehouse_name}</p>
                                                    <p className="text-[11px] text-slate-400">{p.email}</p>
                                                </td>
                                                <td className="p-4 text-sm font-black text-slate-900">{formatINR(p.amount)}</td>
                                                <td className="p-4 text-xs text-slate-500">{formatDate(p.created_at)}</td>
                                                <td className="p-4">
                                                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${st.cls}`}>
                                                        {st.label}
                                                    </span>
                                                </td>
                                                <td className="p-4 max-w-[200px]">
                                                    {p.status === 'requested' ? (
                                                        <input
                                                            value={notes[p.id] || ''}
                                                            onChange={(e) => setNotes((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                                            placeholder="Admin note…"
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-400"
                                                        />
                                                    ) : (
                                                        <span className="text-xs text-slate-400 italic">{p.admin_note || '—'}</span>
                                                    )}
                                                </td>
                                                <td className="p-4 max-w-[160px]">
                                                    {p.transaction_ref ? (
                                                        <span className="text-xs font-mono font-bold text-slate-700">{p.transaction_ref}</span>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 italic">—</span>
                                                    )}
                                                </td>
                                                <td className="p-4 text-right whitespace-nowrap">
                                                    {p.status === 'requested' ? (
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                disabled={processingId === p.id}
                                                                onClick={() => handlePayoutDecision(p, 'paid')}
                                                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 text-white text-xs font-black hover:bg-emerald-600 disabled:opacity-50"
                                                            >
                                                                {processingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                                                Approve
                                                            </button>
                                                            <button
                                                                disabled={processingId === p.id}
                                                                onClick={() => handlePayoutDecision(p, 'rejected')}
                                                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500 text-white text-xs font-black hover:bg-rose-600 disabled:opacity-50"
                                                            >
                                                                {processingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                                                                Reject
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-slate-400">{p.processed_at ? formatDate(p.processed_at) : '—'}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Per-warehouse wallets */}
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="px-6 py-5 border-b border-slate-100">
                            <h2 className="font-black text-slate-900 flex items-center gap-2">
                                <Building2 size={18} className="text-indigo-600" /> Warehouse Wallets &amp; Settlements
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">Click a warehouse to see its settlement records.</p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-slate-50/70">
                                        <th className="p-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Warehouse</th>
                                        <th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Wallet Balance</th>
                                        <th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Lifetime Earnings</th>
                                        <th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Pending</th>
                                        <th className="p-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Settled</th>
                                        <th className="p-4"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {(overview?.warehouses || []).map((wh) => (
                                        <Fragment key={wh.id}>
                                            <tr className="hover:bg-slate-50/50 cursor-pointer" onClick={() => toggleWarehouse(wh)}>
                                                <td className="p-4">
                                                    <p className="text-sm font-bold text-slate-900">{wh.warehouse_name}</p>
                                                    <p className="text-[11px] text-slate-400">{wh.email}</p>
                                                </td>
                                                <td className="p-4 text-right text-sm font-black text-emerald-600">{formatINR(wh.wallet_balance)}</td>
                                                <td className="p-4 text-right text-sm font-bold text-slate-700">{formatINR(wh.lifetime_earnings)}</td>
                                                <td className="p-4 text-right text-sm text-amber-600">{formatINR(wh.pending_settlements_amount)} <span className="text-[10px] text-slate-400">({wh.pending_settlements || 0})</span></td>
                                                <td className="p-4 text-right text-sm text-slate-600">{formatINR(wh.settled_amount)}</td>
                                                <td className="p-4 text-right">
                                                    {expandedWh === wh.id
                                                        ? <ChevronUp size={16} className="inline text-slate-400" />
                                                        : <ChevronDown size={16} className="inline text-slate-400" />}
                                                </td>
                                            </tr>
                                            {expandedWh === wh.id && (
                                                <tr>
                                                    <td colSpan="6" className="p-0">
                                                        <div className="bg-slate-50/60 px-6 py-4">
                                                            {loadingWh === wh.id ? (
                                                                <div className="flex items-center justify-center py-6">
                                                                    <Loader2 className="animate-spin text-indigo-600" size={20} />
                                                                </div>
                                                            ) : (whSettlements[wh.id] || []).length === 0 ? (
                                                                <p className="text-sm text-slate-400 text-center py-6">No settlements for this warehouse yet.</p>
                                                            ) : (
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full">
                                                                        <thead>
                                                                            <tr>
                                                                                <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Order</th>
                                                                                <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                                                                <th className="p-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Item Total</th>
                                                                                <th className="p-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Commission</th>
                                                                                <th className="p-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Net</th>
                                                                                <th className="p-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Settled</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-slate-100">
                                                                            {(whSettlements[wh.id] || []).map((s) => {
                                                                                const st = SETTLEMENT_STATUS_STYLES[s.status] || SETTLEMENT_STATUS_STYLES.pending
                                                                                return (
                                                                                    <tr key={s.id}>
                                                                                        <td className="p-3 text-xs font-bold text-slate-700">{s.order_number || `#${s.order_id}`}</td>
                                                                                        <td className="p-3">
                                                                                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                                                                                        </td>
                                                                                        <td className="p-3 text-right text-xs text-slate-600">{formatINR(s.item_total)}</td>
                                                                                        <td className="p-3 text-right text-xs text-rose-500">−{formatINR(s.commission_amount)}</td>
                                                                                        <td className="p-3 text-right text-xs font-black text-emerald-600">{formatINR(s.net_amount)}</td>
                                                                                        <td className="p-3 text-[11px] text-slate-400">{formatDate(s.settled_at || s.created_at)}</td>
                                                                                    </tr>
                                                                                )
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                    {(overview?.warehouses || []).length === 0 && (
                                        <tr>
                                            <td colSpan="6" className="p-8 text-center text-sm text-slate-400">No active warehouses found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Info note */}
                    <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                        <Clock size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-indigo-700 leading-relaxed">
                            <span className="font-black">Settlement rules:</span> Each delivered order waits for its
                            {overview?.settlement_window_days || 7}-day return window. Once closed (and no refund/return request is active), the
                            warehouse wallet is credited automatically with product value − {overview?.commission_rate ?? 3}% commission.
                            Delivery fees, platform fees and fitting charges are platform revenue. Payout requests are held at request time and
                            paid after you approve — process them on your weekly payout cycle. Tax (TDS/GST) is reserved for future use.
                        </p>
                    </div>
                </>
            )}
        </div>
    )
}
