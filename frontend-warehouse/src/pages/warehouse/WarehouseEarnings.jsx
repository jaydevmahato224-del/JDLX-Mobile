import { useState, useEffect, useCallback } from 'react'
import {
    Wallet,
    TrendingUp,
    Clock,
    Percent,
    ArrowDownToLine,
    RefreshCw,
    Loader2,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    XCircle,
    Hourglass,
    Info,
    IndianRupee,
    History,
    FileText,
    X,
    AlertTriangle
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

const PAYOUT_STATUS_STYLES = {
    requested: { label: 'Requested', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    paid: { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    rejected: { label: 'Rejected', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
}

const SETTLEMENT_STATUS_STYLES = {
    pending: { label: 'Pending', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    settled: { label: 'Settled', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    void: { label: 'Void', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
}

const formatINR = (value) =>
    `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

const formatDate = (value) => {
    if (!value) return '—'
    try {
        return new Date(value).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
        }) + ' ' + new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    } catch {
        return value
    }
}

const WarehouseEarnings = () => {
    const { warehouseToken, warehouseUser } = useStore()
    const [summary, setSummary] = useState(null)
    const [settlements, setSettlements] = useState([])
    const [payouts, setPayouts] = useState([])
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [filter, setFilter] = useState('')
    const [loading, setLoading] = useState(true)
    const [withdrawOpen, setWithdrawOpen] = useState(false)
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [withdrawing, setWithdrawing] = useState(false)
    const [message, setMessage] = useState(null)
    const perPage = 15

    const rawRole = (warehouseUser?.role || warehouseUser?.role_name || '').toLowerCase()
    const isStaffUser = rawRole.includes('billing') || rawRole.includes('staff')
    const isOwner = !isStaffUser

    const fetchSummary = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/earnings`, {
                headers: { Authorization: `Bearer ${warehouseToken}` },
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to load earnings')
            setSummary(data.data || data)
        } catch (err) {
            setMessage({ type: 'error', text: err.message })
        }
    }, [warehouseToken])

    const fetchSettlements = useCallback(async (p, status) => {
        try {
            const params = new URLSearchParams({ page: String(p), per_page: String(perPage) })
            if (status) params.set('status', status)
            const res = await fetch(`${API_BASE_URL}/warehouse/earnings/settlements?${params}`, {
                headers: { Authorization: `Bearer ${warehouseToken}` },
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to load settlements')
            const body = data.data || data
            setSettlements(body.settlements || [])
            setTotal(body.total || 0)
            setPage(body.page || p)
        } catch (err) {
            setMessage({ type: 'error', text: err.message })
        }
    }, [warehouseToken])

    const fetchPayouts = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/earnings/payouts`, {
                headers: { Authorization: `Bearer ${warehouseToken}` },
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to load payouts')
            setPayouts(data.data || data || [])
        } catch (err) {
            setMessage({ type: 'error', text: err.message })
        }
    }, [warehouseToken])

    useEffect(() => {
        if (!warehouseToken) return
        setLoading(true)
        Promise.all([fetchSummary(), fetchPayouts()])
            .finally(() => setLoading(false))
        // Settlements are loaded by the filter effect below (runs once on mount).
    }, [warehouseToken, fetchSummary, fetchPayouts])

    useEffect(() => {
        if (!warehouseToken) return
        fetchSettlements(1, filter)
    }, [filter, warehouseToken, fetchSettlements])

    const handleWithdraw = async () => {
        const amount = parseFloat(withdrawAmount)
        if (!amount || amount <= 0) {
            setMessage({ type: 'error', text: 'Enter a valid amount' })
            return
        }
        if (summary?.wallet && amount > Number(summary.wallet.balance || 0)) {
            setMessage({ type: 'error', text: 'Amount exceeds available balance' })
            return
        }
        setWithdrawing(true)
        setMessage(null)
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/earnings/withdraw`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ amount }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Withdrawal failed')
            setMessage({ type: 'success', text: data.message || 'Payout requested — admin will process it within a week' })
            setWithdrawOpen(false)
            setWithdrawAmount('')
            await Promise.all([fetchSummary(), fetchPayouts()])
        } catch (err) {
            setMessage({ type: 'error', text: err.message })
        } finally {
            setWithdrawing(false)
        }
    }

    const totalPages = Math.max(1, Math.ceil(total / perPage))
    const walletBalance = Number(summary?.wallet?.balance || 0)
    const lifetimeEarnings = Number(summary?.wallet?.lifetime_earnings || 0)

    const statCards = [
        {
            label: 'Wallet Balance',
            value: formatINR(walletBalance),
            sub: 'Available to withdraw',
            icon: Wallet,
            iconCls: 'bg-emerald-500/10 text-emerald-400',
        },
        {
            label: 'Lifetime Earnings',
            value: formatINR(lifetimeEarnings),
            sub: 'Total settled to you',
            icon: TrendingUp,
            iconCls: 'bg-indigo-500/10 text-indigo-400',
        },
        {
            label: 'Pending Settlement',
            value: formatINR(summary?.pending?.amount || 0),
            sub: `${summary?.pending?.count || 0} order(s) in return window`,
            icon: Hourglass,
            iconCls: 'bg-amber-500/10 text-amber-400',
        },
        {
            label: 'Platform Commission',
            value: `${summary?.commission_rate ?? 3}%`,
            sub: 'Deducted from every settlement',
            icon: Percent,
            iconCls: 'bg-rose-500/10 text-rose-400',
        },
    ]

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-6 lg:p-8">
            <div className="max-w-6xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-white tracking-tight">Earnings &amp; Payouts</h1>
                        <p className="text-slate-400 text-sm mt-1">
                            Your sales settled after the return window, minus platform commission — delivery fees stay with the platform.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { fetchSummary(); fetchSettlements(1, filter); fetchPayouts() }}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/60 text-slate-300 text-sm font-bold hover:bg-slate-700/60 transition-colors"
                        >
                            <RefreshCw size={16} /> Refresh
                        </button>
                        {isOwner && (
                            <button
                                onClick={() => setWithdrawOpen(true)}
                                disabled={walletBalance <= 0}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-black hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                <ArrowDownToLine size={16} /> Withdraw
                            </button>
                        )}
                    </div>
                </div>

                {message && (
                    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border ${
                        message.type === 'error'
                            ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    }`}>
                        {message.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                        <span>{message.text}</span>
                        <button onClick={() => setMessage(null)} className="ml-auto text-slate-400 hover:text-white">
                            <X size={16} />
                        </button>
                    </div>
                )}

                {loading && !summary ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="animate-spin text-amber-400" size={28} />
                    </div>
                ) : (
                    <>
                        {/* Stats */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {statCards.map((card) => {
                                const Icon = card.icon
                                return (
                                    <div key={card.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${card.iconCls}`}>
                                            <Icon size={18} />
                                        </div>
                                        <p className="text-2xl font-black text-white">{card.value}</p>
                                        <p className="text-xs font-bold text-slate-400 mt-1">{card.label}</p>
                                        <p className="text-[10px] text-slate-500 mt-0.5">{card.sub}</p>
                                    </div>
                                )
                            })}
                        </div>

                        {/* How it works note */}
                        <div className="flex items-start gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
                            <Info size={18} className="text-amber-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                <span className="font-black text-slate-300">How settlement works:</span> When an order is delivered, it enters the
                                {summary?.settlement_window_days || 7}-day return window. Once the window closes without an active refund/return request,
                                your share (product value − {summary?.commission_rate ?? 3}% commission) is credited to your wallet automatically.
                                Delivery fees, platform fees and fitting charges belong to the platform and are never part of your settlement.
                                Payouts are processed weekly after admin approval.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Settlements */}
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                                    <h2 className="font-black text-white flex items-center gap-2">
                                        <FileText size={16} className="text-amber-400" /> Settlements
                                    </h2>
                                    <div className="flex gap-1 text-[11px] font-bold">
                                        {['', 'pending', 'settled'].map((s) => (
                                            <button
                                                key={s || 'all'}
                                                onClick={() => setFilter(s)}
                                                className={`px-3 py-1 rounded-lg transition-colors ${
                                                    filter === s ? 'bg-amber-500/15 text-amber-400' : 'text-slate-400 hover:text-white'
                                                }`}
                                            >
                                                {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="divide-y divide-slate-800/70 max-h-[420px] overflow-y-auto">
                                    {settlements.length === 0 ? (
                                        <p className="text-sm text-slate-500 px-5 py-10 text-center">
                                            No settlements yet — orders will appear here after delivery.
                                        </p>
                                    ) : settlements.map((s) => {
                                        const st = SETTLEMENT_STATUS_STYLES[s.status] || SETTLEMENT_STATUS_STYLES.pending
                                        return (
                                            <div key={s.id} className="px-5 py-3.5">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold text-white truncate">
                                                            {s.order_number || `Order #${s.order_id}`}
                                                        </p>
                                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                                            {formatDate(s.created_at)}
                                                        </p>
                                                    </div>
                                                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${st.cls}`}>
                                                        {st.label}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-4 gap-2 mt-2 text-[11px]">
                                                    <div>
                                                        <p className="text-slate-500">Item value</p>
                                                        <p className="font-bold text-slate-300">{formatINR(s.item_total)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-500">Commission</p>
                                                        <p className="font-bold text-rose-400">−{formatINR(s.commission_amount)}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-slate-500">Tax</p>
                                                        <p className="font-bold text-slate-300">{formatINR(s.tax_deducted)}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-slate-500">Net</p>
                                                        <p className="font-black text-emerald-400">{formatINR(s.net_amount)}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800">
                                        <button
                                            disabled={page <= 1}
                                            onClick={() => fetchSettlements(page - 1, filter)}
                                            className="flex items-center gap-1 text-xs font-bold text-slate-400 disabled:opacity-30 hover:text-white"
                                        >
                                            <ChevronLeft size={14} /> Prev
                                        </button>
                                        <span className="text-[11px] text-slate-500">Page {page} of {totalPages}</span>
                                        <button
                                            disabled={page >= totalPages}
                                            onClick={() => fetchSettlements(page + 1, filter)}
                                            className="flex items-center gap-1 text-xs font-bold text-slate-400 disabled:opacity-30 hover:text-white"
                                        >
                                            Next <ChevronRight size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Payout history */}
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                                    <h2 className="font-black text-white flex items-center gap-2">
                                        <History size={16} className="text-emerald-400" /> Payout History
                                    </h2>
                                </div>
                                <div className="divide-y divide-slate-800/70 max-h-[420px] overflow-y-auto">
                                    {payouts.length === 0 ? (
                                        <p className="text-sm text-slate-500 px-5 py-10 text-center">
                                            No payouts yet — request a withdrawal from your wallet balance.
                                        </p>
                                    ) : payouts.map((p) => {
                                        const st = PAYOUT_STATUS_STYLES[p.status] || PAYOUT_STATUS_STYLES.requested
                                        return (
                                            <div key={p.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-black text-white">{formatINR(p.amount)}</p>
                                                    <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(p.created_at)}</p>
                                                    {p.admin_note && (
                                                        <p className="text-[10px] text-slate-500 mt-0.5 italic">Note: {p.admin_note}</p>
                                                    )}
                                                </div>
                                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${st.cls}`}>
                                                    {st.label}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Withdraw modal */}
            {withdrawOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
                    <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-lg font-black text-white flex items-center gap-2">
                                <ArrowDownToLine size={18} className="text-emerald-400" /> Request Payout
                            </h3>
                            <button onClick={() => setWithdrawOpen(false)} className="text-slate-500 hover:text-white">
                                <X size={18} />
                            </button>
                        </div>
                        <p className="text-xs text-slate-400 mb-4">
                            Available balance: <span className="font-black text-emerald-400">{formatINR(walletBalance)}</span>
                            <br />Amount is held immediately and paid out after admin approval (processed weekly).
                        </p>
                        <label className="block text-xs font-bold text-slate-400 mb-1.5">Amount (₹)</label>
                        <div className="relative mb-5">
                            <IndianRupee size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={withdrawAmount}
                                onChange={(e) => setWithdrawAmount(e.target.value)}
                                placeholder="0"
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-white font-black focus:outline-none focus:border-emerald-500"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setWithdrawAmount(String(Math.floor(walletBalance)))}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 hover:bg-slate-700"
                            >
                                Max
                            </button>
                            <button
                                onClick={handleWithdraw}
                                disabled={withdrawing}
                                className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-black hover:bg-emerald-400 disabled:opacity-50"
                            >
                                {withdrawing && <Loader2 size={15} className="animate-spin" />}
                                Request Payout
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default WarehouseEarnings
