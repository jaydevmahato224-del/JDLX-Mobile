import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
    ArrowLeft,
    ShoppingBag,
    Search,
    Loader2,
    MapPin,
    CheckCircle2,
    XCircle,
    Clock,
    Phone,
    Package,
    Truck,
    AlertCircle,
    ArrowRight,
    ExternalLink,
    User,
    CreditCard,
    IndianRupee,
    CalendarDays,
    Scissors,
    Boxes,
    ClipboardList
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'

const WarehouseOrderDetail = () => {
    const { warehouseLogout } = useStore()
    const { assignmentId } = useParams()
    const navigate = useNavigate()
    const [order, setOrder] = useState(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    const [updatingId, setUpdatingId] = useState(null)
    const [dispatching, setDispatching] = useState(false)
    const [weight, setWeight] = useState('')
    const [notification, setNotification] = useState(null)
    const [itemSearch, setItemSearch] = useState('')

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type })
        setTimeout(() => setNotification(null), 3000)
    }

    const fetchOrder = useCallback(async () => {
        setLoading(true)
        setNotFound(false)
        try {
            const response = await apiFetch(`/warehouse/orders/${assignmentId}`, {
                // Detail page errors are surfaced inline (see below) — never the
                // full-screen takeover. The operator must stay on the page.
                skipGlobalError: true
            })
            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                return
            }
            if (response.status === 404) {
                setNotFound(true)
                return
            }
            if (!response.ok) throw new Error('Failed to fetch order details')
            const data = await response.json()
            setOrder(data.data || null)
        } catch (err) {
            showNotification(err.message || 'Network error — please try again', 'error')
            setNotFound(true)
        } finally {
            setLoading(false)
        }
    }, [assignmentId, warehouseLogout])

    useEffect(() => {
        fetchOrder()
    }, [fetchOrder])

    // Same status machine as the Orders list — this page reuses identical
    // transitions so business logic is untouched, just re-rendered in a
    // full-page layout with more room for details.
    const handleUpdateStatus = async (newStatus) => {
        setUpdatingId(newStatus)
        try {
            const response = await apiFetch(`/warehouse/orders/${assignmentId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: newStatus }),
                skipGlobalError: true
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(result.error || 'Status update failed')

            showNotification(`Order marked as ${newStatus}`)
            await fetchOrder()
        } catch (err) {
            showNotification(err.message || 'Network error — please try again', 'error')
        } finally {
            setUpdatingId(null)
        }
    }

    // Pack-ready handoff to Shiprocket (same endpoint/flow as the list page).
    const handleShiprocketDispatch = async () => {
        setDispatching(true)
        try {
            const response = await apiFetch(`/warehouse/orders/${assignmentId}/dispatch`, {
                method: 'PATCH',
                body: JSON.stringify({ weight_kg: parseFloat(weight) || 0.5 }),
                skipGlobalError: true
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(result.error || result.message || 'Shiprocket dispatch failed')

            const awb = result.data?.awb_code
            const courier = result.data?.courier_name
            showNotification(`AWB ${awb || '—'} • ${courier || 'Courier'} — pickup will be scheduled`, 'success')
            await fetchOrder()
        } catch (err) {
            showNotification(err.message || 'Network error — please try again', 'error')
        } finally {
            setDispatching(false)
        }
    }

    const getStatusColor = (status) => {
        switch (status?.toLowerCase()) {
            case 'assigned': return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
            case 'accepted': return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
            case 'packing': return 'bg-purple-500/10 text-purple-500 border-purple-500/20'
            case 'packed': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
            case 'dispatched': return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
            case 'rejected':
            case 'cancelled': return 'bg-rose-500/10 text-rose-500 border-rose-500/20'
            default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20'
        }
    }

    const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—')

    const filteredItems = (order?.items || []).filter(item => {
        const q = itemSearch.toLowerCase()
        return (
            (item.product_name?.toLowerCase() || '').includes(q) ||
            (item.device_model?.toLowerCase() || '').includes(q) ||
            (item.variant_name?.toLowerCase() || '').includes(q)
        )
    })

    if (loading && !order) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium">Loading order details...</p>
            </div>
        )
    }

    if (notFound || !order) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
                <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
                <h1 className="text-xl font-black text-white uppercase tracking-widest">Order not found</h1>
                <p className="text-slate-400 text-sm mt-2">This order doesn't exist or isn't assigned to your warehouse.</p>
                <button
                    onClick={() => navigate('/warehouse/orders')}
                    className="mt-6 h-11 px-6 rounded-xl bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all"
                >
                    Back to Orders
                </button>
            </div>
        )
    }

    const isCancelled = order.assignment_status?.toUpperCase() === 'CANCELLED' || order.order_status?.toUpperCase() === 'CANCELLED'
    const codRemaining = Number(order.cod_remaining_amount) || 0
    const codAdvance = Number(order.cod_advance_paid) || 0

    return (
        <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-700 pb-10">
            {/* Notification Toast */}
            {notification && (
                <div className={`fixed top-24 right-8 z-[110] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl animate-in slide-in-from-right-8 fade-in border ${
                    notification.type === 'error'
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-200'
                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                }`}>
                    {notification.type === 'error' ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
                    <span className="font-bold text-sm uppercase tracking-wide">{notification.message}</span>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                    <Link
                        to="/warehouse/orders"
                        className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all shrink-0"
                        title="Back to Orders"
                    >
                        <ArrowLeft size={18} />
                    </Link>
                    <div className="min-w-0">
                        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-3 flex-wrap">
                            <ShoppingBag className="text-amber-500 shrink-0" size={30} />
                            #{order.order_number || `ORD-${order.order_id}`}
                        </h1>
                        <p className="text-slate-400 mt-2 font-medium flex items-center gap-2 text-sm">
                            <Clock size={14} /> Placed {formatDate(order.created_at)}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${getStatusColor(order.assignment_status)}`}>
                        {order.assignment_status}
                    </span>
                    {order.order_status && (
                        <span className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-300">
                            Order: {order.order_status}
                        </span>
                    )}
                    <button
                        onClick={fetchOrder}
                        className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                        title="Refresh"
                    >
                        <Loader2 size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {isCancelled && order.cancellation_reason && (
                <div className="warehouse-panel p-4 border-rose-500/20 bg-rose-500/5 flex items-center gap-3">
                    <AlertCircle size={18} className="text-rose-500 shrink-0" />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">Cancelled by user</p>
                        <p className="text-sm font-bold text-rose-200 mt-0.5">Reason: {order.cancellation_reason}</p>
                    </div>
                </div>
            )}

            {/* Fulfillment Actions (same flows as list page) */}
            <div className="warehouse-panel p-4 sm:p-5 border-white/5 bg-slate-900/40 backdrop-blur-xl">
                <div className="flex items-center gap-2 mb-4">
                    <ClipboardList size={16} className="text-amber-500" />
                    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Fulfillment Actions</h2>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {!isCancelled && order.assignment_status === 'assigned' && (
                        <>
                            <button
                                onClick={() => handleUpdateStatus('accepted')}
                                disabled={!!updatingId}
                                className="h-11 px-6 rounded-xl bg-emerald-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <CheckCircle2 size={14} /> Accept Order
                            </button>
                            <button
                                onClick={() => handleUpdateStatus('rejected')}
                                disabled={!!updatingId}
                                className="h-11 px-6 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[11px] font-black uppercase tracking-widest hover:bg-rose-500/20 transition-all disabled:opacity-50"
                            >
                                Reject Order
                            </button>
                        </>
                    )}

                    {order.assignment_status === 'accepted' && (
                        <button
                            onClick={() => handleUpdateStatus('packing')}
                            disabled={!!updatingId}
                            className="h-11 px-6 rounded-xl bg-amber-400 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            Start Packing <ArrowRight size={14} />
                        </button>
                    )}

                    {order.assignment_status === 'packing' && (
                        <button
                            onClick={() => handleUpdateStatus('packed')}
                            disabled={!!updatingId}
                            className="h-11 px-6 rounded-xl bg-purple-500 text-white text-[11px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-purple-500/20"
                        >
                            Mark Packed <CheckCircle2 size={14} />
                        </button>
                    )}

                    {order.assignment_status === 'packed' && (
                        <>
                            <input
                                type="number"
                                step="0.1"
                                min="0.1"
                                value={weight}
                                placeholder="kg"
                                onChange={(e) => setWeight(e.target.value)}
                                className="h-11 w-24 bg-slate-950/50 border border-white/10 rounded-xl px-3 text-sm font-bold text-white focus:outline-none focus:border-amber-400/50"
                                title="Package weight (kg, default 0.5)"
                            />
                            <button
                                onClick={handleShiprocketDispatch}
                                disabled={dispatching || !!updatingId}
                                className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                                title="Create Shiprocket order, assign courier and generate AWB"
                            >
                                {dispatching ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                                Ship via Shiprocket
                            </button>
                            <button
                                onClick={() => handleUpdateStatus('dispatched')}
                                disabled={!!updatingId || dispatching}
                                className="h-11 px-5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                                title="Mark dispatched without Shiprocket (self-fulfilled)"
                            >
                                Manual Dispatch
                            </button>
                        </>
                    )}

                    {order.assignment_status === 'dispatched' && (
                        <div className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                            Order dispatched — no further actions
                        </div>
                    )}

                    {isCancelled && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[10px] font-black text-rose-400 uppercase tracking-widest">
                            <XCircle size={12} /> Cancelled by User
                        </div>
                    )}

                    {updatingId && <Loader2 size={16} className="text-amber-400 animate-spin" />}
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 sm:gap-6">
                {/* Left column — items */}
                <div className="xl:col-span-2 space-y-5 sm:space-y-6">
                    {/* Items */}
                    <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl overflow-hidden">
                        <div className="px-4 sm:px-6 py-4 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                                <Boxes size={16} className="text-amber-500" />
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                                    Order Items ({order.total_quantity || order.items?.length || 0} units)
                                </h2>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search items..."
                                    value={itemSearch}
                                    onChange={(e) => setItemSearch(e.target.value)}
                                    className="w-44 sm:w-56 bg-slate-950/50 border border-white/10 rounded-xl py-2 pl-9 pr-3 text-xs text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all"
                                />
                            </div>
                        </div>
                        <div className="divide-y divide-white/5">
                            {filteredItems.length > 0 ? filteredItems.map((item) => (
                                <div key={item.id} className="px-4 sm:px-6 py-4 flex items-start gap-4">
                                    {item.product_image ? (
                                        <img
                                            src={item.product_image}
                                            alt={item.product_name || 'Product'}
                                            className="w-14 h-14 rounded-xl object-cover bg-slate-950/60 border border-white/5 shrink-0"
                                        />
                                    ) : (
                                        <div className="w-14 h-14 rounded-xl bg-slate-950/60 border border-white/5 flex items-center justify-center shrink-0">
                                            <Package size={20} className="text-slate-600" />
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-black text-white leading-snug">{item.product_name || 'Product'}</p>
                                        {item.variant_name && (
                                            <p className="text-[11px] font-bold text-slate-400 mt-0.5">Variant: {item.variant_name}</p>
                                        )}
                                        {item.device_model && (
                                            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20 text-[9px] font-black text-amber-300 uppercase tracking-tight">
                                                <Scissors size={10} /> Custom fit: {item.device_model}
                                            </div>
                                        )}
                                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
                                            <span>Qty: <span className="text-slate-300">×{item.quantity}</span></span>
                                            <span>Price: <span className="text-slate-300">₹{item.price}</span></span>
                                            {item.subtotal && Number(item.subtotal) !== Number(item.price) * item.quantity && (
                                                <span>Subtotal: <span className="text-amber-400">₹{item.subtotal}</span></span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-sm font-black text-amber-400">₹{Number(item.subtotal ?? (item.price * item.quantity)).toFixed(2)}</p>
                                    </div>
                                </div>
                            )) : (
                                <div className="px-4 sm:px-6 py-8 text-center">
                                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">No matching items</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Shipment & Tracking */}
                    <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl overflow-hidden">
                        <div className="px-4 sm:px-6 py-4 border-b border-white/5 flex items-center gap-2">
                            <Truck size={16} className="text-amber-500" />
                            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Shipment & Tracking</h2>
                        </div>
                        <div className="px-4 sm:px-6 py-5 space-y-4">
                            {order.awb_code || order.shipment_status ? (
                                <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">AWB Code</p>
                                            <p className="text-sm font-black text-emerald-400 mt-1">{order.awb_code || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Courier</p>
                                            <p className="text-sm font-black text-white mt-1">{order.courier_name || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Shipment Status</p>
                                            <p className="text-sm font-black text-white mt-1 capitalize">{order.shipment_status || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Pickup Scheduled</p>
                                            <p className="text-sm font-black text-white mt-1">{order.pickup_scheduled_date || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Shiprocket Order ID</p>
                                            <p className="text-sm font-bold text-slate-300 mt-1 break-all">{order.shiprocket_order_id || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Shipment ETA</p>
                                            <p className="text-sm font-bold text-slate-300 mt-1">{order.shipment_eta || order.estimated_delivery || '—'}</p>
                                        </div>
                                    </div>
                                    {order.tracking_url && (
                                        <a
                                            href={order.tracking_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-black uppercase tracking-widest hover:bg-blue-500/20 transition-all"
                                        >
                                            Track Package <ExternalLink size={12} />
                                        </a>
                                    )}
                                </>
                            ) : (
                                <div className="flex items-center gap-3 opacity-50">
                                    <Clock size={18} className="text-slate-500 shrink-0" />
                                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                                        No shipment yet — AWB details appear here after dispatch
                                    </p>
                                </div>
                            )}

                            {order.tracking_timeline?.length > 0 && (
                                <div className="pt-4 border-t border-white/5">
                                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3">Tracking Timeline</p>
                                    <div className="space-y-3">
                                        {order.tracking_timeline.map((event, idx) => (
                                            <div key={idx} className="flex items-start gap-3">
                                                <div className="mt-1 w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-xs font-black text-white uppercase tracking-wide">{event.status}</p>
                                                    {event.description && (
                                                        <p className="text-[11px] font-bold text-slate-400 mt-0.5">{event.description}</p>
                                                    )}
                                                    <p className="text-[10px] font-bold text-slate-600 mt-0.5">
                                                        {[event.location, event.timestamp ? new Date(event.timestamp).toLocaleString() : null].filter(Boolean).join(' • ')}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right column — customer, payment, summary */}
                <div className="space-y-5 sm:space-y-6">
                    {/* Customer & Delivery */}
                    <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl">
                        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
                            <User size={16} className="text-amber-500" />
                            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Customer & Delivery</h2>
                        </div>
                        <div className="px-5 py-5 space-y-4">
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Customer</p>
                                <p className="text-sm font-black text-white mt-1">{order.customer_name || order.user_name || 'Valued Customer'}</p>
                            </div>
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Phone</p>
                                <a
                                    href={`tel:${order.phone || order.customer_phone || ''}`}
                                    className="mt-1 inline-flex items-center gap-2 text-sm font-black text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    <Phone size={13} /> {order.phone || order.customer_phone || '—'}
                                </a>
                            </div>
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-1.5">
                                    <MapPin size={11} /> Delivery Address
                                </p>
                                <p className="text-xs font-bold text-slate-300 mt-1 leading-relaxed break-words">
                                    {order.delivery_address || '—'}
                                </p>
                            </div>
                            {order.estimated_delivery && !order.awb_code && (
                                <div>
                                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-1.5">
                                        <CalendarDays size={11} /> Estimated Delivery
                                    </p>
                                    <p className="text-xs font-black text-white mt-1">{order.estimated_delivery}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Payment */}
                    <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl">
                        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
                            <CreditCard size={16} className="text-amber-500" />
                            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Payment</h2>
                        </div>
                        <div className="px-5 py-5 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Method</span>
                                <span className="text-xs font-black text-white uppercase">{order.payment_type || 'PREPAID'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</span>
                                <span className={`text-xs font-black uppercase ${
                                    ['paid', 'advance_paid'].includes((order.payment_status || '').toLowerCase())
                                    ? 'text-emerald-400' : 'text-amber-400'
                                }`}>
                                    {(order.payment_status || 'pending').replace(/_/g, ' ')}
                                </span>
                            </div>
                            {order.payment_type === 'COD' && codAdvance > 0 && (
                                <>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Advance Paid</span>
                                        <span className="text-xs font-black text-emerald-400">₹{codAdvance.toFixed(2)}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Collect on Delivery</span>
                                        <span className="text-xs font-black text-amber-400">₹{codRemaining.toFixed(2)}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Bill Summary */}
                    <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl">
                        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
                            <IndianRupee size={16} className="text-amber-500" />
                            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Bill Summary</h2>
                        </div>
                        <div className="px-5 py-5 space-y-2.5">
                            {[
                                ['Subtotal', order.subtotal_amount],
                                ['Tax / GST', order.tax_amount],
                                ['Discount', order.discount_amount, true],
                                ['Platform Fee', order.platform_fee],
                                ['Delivery Fee', order.delivery_fee],
                                ['Fitting Charge', order.fitting_charge],
                            ].filter(([, v]) => v !== null && v !== undefined && Number(v) !== 0)
                             .map(([label, value, isDiscount]) => (
                                <div key={label} className="flex items-center justify-between gap-3">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
                                    <span className={`text-xs font-black ${isDiscount ? 'text-emerald-400' : 'text-slate-200'}`}>
                                        {isDiscount ? '−' : ''}₹{Number(value).toFixed(2)}
                                    </span>
                                </div>
                            ))}
                            <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-3">
                                <span className="text-xs font-black uppercase tracking-widest text-white">Total</span>
                                <span className="text-lg font-black text-amber-400">₹{Number(order.total_amount).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Assignment Timeline */}
                    <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl">
                        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
                            <CalendarDays size={16} className="text-amber-500" />
                            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Timeline</h2>
                        </div>
                        <div className="px-5 py-5 space-y-3">
                            {[
                                ['Assigned to warehouse', order.assigned_at],
                                ['Order placed', order.created_at],
                                ['Packed', order.packed_at],
                                ['Shipped', order.shipped_at],
                                ['Delivered', order.delivered_at],
                            ].filter(([, v]) => v)
                             .map(([label, value]) => (
                                <div key={label} className="flex items-start justify-between gap-3">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
                                    <span className="text-[11px] font-bold text-slate-300 text-right">{formatDate(value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default WarehouseOrderDetail
