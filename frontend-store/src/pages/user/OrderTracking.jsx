import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Package, Truck, CheckCircle, Clock, MapPin, Phone, XCircle, Undo2, AlertCircle, MessageSquare, Flag, RotateCcw, ExternalLink, ChevronDown, Check, Ban, CreditCard, Download } from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { apiFetch } from '../../utils/apiFetch'
import { loadRazorpay } from '../../utils/loadRazorpay'
import { downloadOrderInvoice, invoiceAvailable } from '../../utils/downloadInvoice'
import { toast } from 'react-hot-toast'

function OrderTracking() {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const [order, setOrder] = useState(null);
    const [error, setError] = useState(null);
    const [payingNow, setPayingNow] = useState(false);
    const [trackingInfo, setTrackingInfo] = useState(null);
    const [riderLocation, setRiderLocation] = useState(null);
    const [routeData, setRouteData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [invoiceBusy, setInvoiceBusy] = useState(false);
    const [, setShipmentLoading] = useState(false);
    const [shipmentData, setShipmentData] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [refundReason, setRefundReason] = useState('');
    const [showRefundForm, setShowRefundForm] = useState(false);
    const [showCancelForm, setShowCancelForm] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [customReason, setCustomReason] = useState('');
    const [message, setMessage] = useState({ type: '', text: '' });
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Payment recovery: an order still PLACED with pending payment means the
    // gateway step at checkout failed or was dismissed. Offer Complete Payment
    // right on the tracking page so the order doesn't stay stuck forever.
    const needsPayment = order &&
        (order.status || '').toUpperCase() === 'PLACED' &&
        (order.payment_status || 'pending').toLowerCase() === 'pending';

    const handleCompletePayment = async () => {
        if (payingNow) return;
        setPayingNow(true);
        try {
            const res = await apiFetch('/payment/retry', {
                method: 'POST',
                body: JSON.stringify({ order_id: Number(orderId) })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.message || data?.error || 'Could not start payment');

            const paymentData = data.data || {};
            await loadRazorpay();

            const rzp = new window.Razorpay({
                key: paymentData.key_id,
                amount: paymentData.amount,
                currency: paymentData.currency,
                name: 'JDLX Mobile',
                description: `Order #${order?.order_number || orderId}`,
                order_id: paymentData.razorpay_order_id,
                prefill: { contact: order?.customer_phone || '' },
                theme: { color: '#6366f1' },
                handler: async (response) => {
                    try {
                        const verifyRes = await apiFetch('/payment/verify', {
                            method: 'POST',
                            body: JSON.stringify({
                                order_id: Number(orderId),
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature
                            })
                        });
                        if (verifyRes.ok) {
                            toast.success('Payment successful! Your order is confirmed.');
                            // Refresh so the timeline shows CONFIRMED.
                            window.location.reload();
                        } else {
                            const err = await verifyRes.json().catch(() => ({}));
                            toast.error(err?.message || 'Payment verification failed');
                        }
                    } catch (e) {
                        console.error('Verification error:', e);
                        toast.error('Payment verification encountered an error');
                    } finally {
                        setPayingNow(false);
                    }
                },
                modal: {
                    ondismiss: () => {
                        setPayingNow(false);
                        toast.error('Payment cancelled');
                    }
                }
            });
            rzp.on('payment.failed', () => {
                setPayingNow(false);
                toast.error('Payment failed. Please try again.');
            });
            rzp.open();
        } catch (e) {
            console.error('Retry payment error:', e);
            toast.error(e.message || 'Something went wrong');
            setPayingNow(false);
        }
    };

    // Haversine formula for client-side distance calculation
    const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    useEffect(() => {
        const fetchTracking = async () => {
            try {
                const res = await apiFetch(`/order/${orderId}/tracking`);
                if (res.ok) {
                    const data = await res.json();
                    setTrackingInfo(data);
                }
            } catch {
                console.error('Failed to fetch tracking info');
            }
        };

        const fetchStatus = async () => {
            try {
                const res = await apiFetch(`/order/${orderId}/status`);
                if (res.ok) {
                    const data = await res.json();
                    setOrder(data);
                    fetchTracking(); // Fetch streamlined tracking info too
                } else {
                    setError('Order not found or access denied.');
                }
            } catch {
                setError('Failed to fetch order status.');
            } finally {
                setLoading(false);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 30000); // Poll order status every 30s
        return () => clearInterval(interval);
    }, [orderId]);

    useEffect(() => {
        let riderInterval;
        if (order?.status === 'OUT_FOR_DELIVERY') {
            const fetchRiderLocation = async () => {
                try {
                    const res = await apiFetch(`/order/${orderId}/rider-location`);
                    if (res.ok) {
                        const data = await res.json();
                        setRiderLocation(data);
                    }
                } catch {
                    console.error('Failed to fetch rider location');
                }
            };
            fetchRiderLocation();
            riderInterval = setInterval(fetchRiderLocation, 10000); // Poll rider every 10s
        }
        return () => clearInterval(riderInterval);
    }, [order?.status, orderId]);

    useEffect(() => {
        let routeInterval;
        if (order?.delivery_partner_id && order?.status !== 'DELIVERED') {
            const fetchRoute = async () => {
                try {
                    const res = await apiFetch(`/order/${orderId}/route`);
                    if (res.ok) {
                        const data = await res.json();
                        setRouteData(data);
                    }
                } catch {
                    console.error('Failed to fetch route info');
                }
            };
            fetchRoute();
            routeInterval = setInterval(fetchRoute, 15000); // Poll route every 15s
        }
        return () => clearInterval(routeInterval);
    }, [order?.delivery_partner_id, order?.status, orderId]);

    useEffect(() => {
        const fetchShipmentTracking = async () => {
            // (delivery_type === 'quick' gate removed — quick delivery is
            // retired, so every order uses standard shipment tracking.)
            if (!order) return;
            setShipmentLoading(true);
            try {
                const res = await apiFetch(`/shipment/track/${orderId}`);
                if (res.ok) {
                    const data = await res.json();
                    setShipmentData(data.data);
                }
            } catch {
                console.error('Failed to fetch shipment tracking');
            } finally {
                setShipmentLoading(false);
            }
        };
        fetchShipmentTracking();
    }, [order, orderId]);

    const handleCancelSubmit = async (e) => {
        if (e) e.preventDefault();
        let finalReason = cancelReason;
        if (cancelReason === 'Other') {
            finalReason = customReason.trim();
        }
        if (!finalReason) {
            alert("Please select or enter a cancellation reason!");
            return;
        }
        setActionLoading(true);
        try {
            const res = await apiFetch(`/order/${orderId}/cancel`, {
                method: "POST",
                body: JSON.stringify({ reason: finalReason })
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: "success", text: "Order cancelled successfully." });
                setOrder(prev => ({ ...prev, status: "CANCELLED" }));
                setShowCancelForm(false);
            } else {
                setMessage({ type: "error", text: data.error || "Failed to cancel order." });
            }
        } catch {
            setMessage({ type: "error", text: "An error occurred." });
        } finally {
            setActionLoading(false);
        }
    };

    const handleRefundRequest = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            const res = await apiFetch(`/order/${orderId}/refund-request`, {
                method: 'POST',
                body: JSON.stringify({ reason: refundReason })
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: "Refund request submitted." });
                setOrder(prev => ({ ...prev, status: 'REFUND_REQUESTED' }));
                setShowRefundForm(false);
            } else {
                setMessage({ type: 'error', text: data.error || "Failed to submit request." });
            }
        } catch {
            setMessage({ type: 'error', text: "An error occurred." });
        } finally {
            setActionLoading(false);
        }
    };

    // Terminal/blocked statuses shown distinctly instead of the delivery timeline.
    const terminalStatuses = ['CANCELLED', 'REFUNDED', 'REJECTED', 'RETURNED', 'INVENTORY_UNAVAILABLE'];
    const isTerminalStatus = terminalStatuses.includes(order?.status?.toUpperCase());
    // REFUND_REQUESTED is a pending state (not terminal) but still needs the
    // status banner + Need Help section so the "Refund request submitted"
    // message stays visible after the user submits it.
    const isPendingRefundRequest = order?.status?.toUpperCase() === 'REFUND_REQUESTED';
    const isOrderInactive = isTerminalStatus || isPendingRefundRequest;

    const stages = [
        { id: 'PLACED', label: 'Order Placed', icon: Clock, time: order?.created_at, desc: 'We received your order' },
        { id: 'CONFIRMED', label: 'Confirmed', icon: CheckCircle, time: order?.confirmed_at, desc: 'Warehouse accepted — packing coming up' },
        { id: 'PACKED', label: 'Packed', icon: Package, time: order?.packed_at, desc: 'Your items are sealed & ready' },
        { id: 'SHIPPED', label: 'Shipped', icon: Truck, time: order?.shipped_at, desc: 'Handed to the courier' },
        { id: 'DELIVERED', label: 'Delivered', icon: CheckCircle, time: order?.delivered_at, desc: 'Enjoy your order!' }
    ];

    const getCurrentStageIndex = () => {
        return stages.findIndex(s => s.id === order?.status);
    };

    // First image from the product's image list (JSON array or comma-separated).
    const getItemImage = (item) => {
        const raw = item?.images || '';
        if (!raw) return '';
        try {
            if (typeof raw === 'string' && raw.trim().startsWith('[')) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
            }
        } catch { /* ignore */ }
        const first = String(raw).split(',')[0]?.trim();
        return first || '';
    };

    if (loading) return <div className="p-10 text-center text-[var(--color-on-surface-variant)]">Tracking your order...</div>;
    if (error) return (
        <div className="p-10 text-center flex flex-col items-center gap-4 text-[var(--color-on-surface-variant)]">
            <p>{error}</p>
            <Link to="/" className="text-primary font-bold">Back to Home</Link>
        </div>
    );

    const activeIndex = getCurrentStageIndex();
    // Human-friendly status copy for the hero. The old "Confirmed — In
    // Progress..." read like something was stuck; these say what is actually
    // happening at each step.
    const statusCopy = {
        PLACED:    { title: 'Order Received', sub: 'Waiting for the warehouse to accept your order' },
        CONFIRMED: { title: 'Confirmed at Warehouse', sub: 'Accepted by the warehouse — packing starts next' },
        PACKING:   { title: 'Being Packed', sub: 'Your items are being packed right now' },
        PACKED:    { title: 'Packed & Ready', sub: 'Sealed and ready for courier handoff' },
        SHIPPED:   { title: 'Shipped', sub: 'Your parcel is on its way' },
        OUT_FOR_DELIVERY: { title: 'Out for Delivery', sub: 'Arriving today — keep your phone handy' },
        DELIVERED: { title: 'Delivered', sub: 'Thanks for shopping with JDLX!' }
    };
    const hero = statusCopy[order?.status?.toUpperCase()] || { title: 'Order Received', sub: 'We are processing your order' };
    const progressPct = activeIndex < 0 ? 8 : Math.min(100, Math.round(((activeIndex + (order?.status === 'DELIVERED' ? 1 : 0.5)) / stages.length) * 100));

    const fmtStageTime = (t) => {
        if (!t) return '';
        const d = new Date(t);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="container-standard py-6 flex flex-col gap-6">
            <div className="flex items-center gap-4">
                <Link to="/" className="p-2 hover:bg-white/40 rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-[var(--color-on-surface-variant)]" />
                </Link>
                <h1 className="text-2xl font-bold text-[var(--color-on-surface)]">Track Order #{order?.order_number || orderId}</h1>
                {invoiceAvailable(order?.created_at) && (
                    <button
                        onClick={() => downloadOrderInvoice(orderId, { setBusy: setInvoiceBusy, filename: `${order?.order_number || `ORD-${orderId}`}-invoice.pdf` })}
                        disabled={invoiceBusy}
                        className="ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider bg-primary/10 text-primary-dark border border-primary/20 hover:bg-primary/20 active:scale-95 transition-all disabled:opacity-50"
                    >
                        <Download className="w-3.5 h-3.5" />
                        {invoiceBusy ? 'Preparing…' : 'Invoice'}
                    </button>
                )}
            </div>

            <div className="glass-card p-6 flex flex-col gap-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Truck className="w-24 h-24 text-primary" />
                </div>

                {needsPayment && (
                    <div className="flex flex-col gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                                <CreditCard className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="text-sm font-black text-amber-700">Payment Pending</p>
                                <p className="text-[11px] font-bold text-amber-600">
                                    Your order is placed but payment isn't complete — complete it to move your order to the warehouse.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleCompletePayment}
                            disabled={payingNow}
                            className={`w-full py-3 rounded-xl font-black text-sm tracking-tight flex items-center justify-center gap-2 transition-all ${
                                payingNow ? 'bg-amber-200 text-amber-400' : 'bg-amber-500 text-white hover:bg-amber-600'
                            }`}
                        >
                            <CreditCard className="w-4 h-4" />
                            {payingNow ? 'Opening payment…' : 'Complete Payment'}
                        </button>
                    </div>
                )}

                {isOrderInactive ? (
                    <div className="flex flex-col gap-4">
                        <div className={`flex items-center gap-3 p-4 rounded-2xl ${order?.status?.toUpperCase() === 'CANCELLED' ? 'bg-red-50 border border-red-100' : 'bg-[var(--color-surface-low)] border border-[var(--color-surface-high)]'}`}>
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${order?.status?.toUpperCase() === 'CANCELLED' ? 'bg-red-500 text-white' : 'bg-slate-400 text-white'}`}>
                                <Ban className="w-6 h-6" />
                            </div>
                            <div>
                                <p className={`text-lg font-black tracking-tight ${order?.status?.toUpperCase() === 'CANCELLED' ? 'text-red-600' : 'text-[var(--color-on-surface-variant)]'}`}>
                                    {isPendingRefundRequest ? 'Refund Requested' : (order?.status || 'Cancelled').replace(/_/g, ' ')}
                                </p>
                                <p className="text-[11px] font-bold text-gray-400 mt-0.5">
                                    {order?.status?.toUpperCase() === 'CANCELLED'
                                        ? 'This order has been cancelled.'
                                        : isPendingRefundRequest
                                            ? 'Your refund request has been submitted and is being reviewed.'
                                            : 'This order is no longer active.'}
                                </p>
                            </div>
                        </div>
                        {order?.cancellation_reason && (
                            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                                <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-0.5">Cancellation Reason</p>
                                <p className="text-xs font-bold text-amber-800">{order.cancellation_reason}</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Hero status card — gradient, status-aware copy and a
                            progress bar so the customer instantly sees where
                            their order is and what happens next. */}
                        <div className="relative rounded-3xl p-6 bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-dark)] text-white overflow-hidden shadow-xl shadow-amber-500/25">
                            <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
                            <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
                            <div className="relative flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/70">
                                        {order?.status === 'DELIVERED' ? 'Completed' : 'Estimated Delivery'}
                                    </p>
                                    <p className="text-3xl font-black tracking-tighter mt-1">
                                        {order?.status === 'DELIVERED' ? 'Delivered 🎉' : (trackingInfo?.estimated_delivery_time || order?.estimated_delivery || '5-7 working days')}
                                    </p>
                                </div>
                                <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 border border-white/20">
                                    {(() => {
                                        const StageIcon = stages[Math.max(0, activeIndex)]?.icon || Clock;
                                        return <StageIcon className="w-7 h-7" />;
                                    })()}
                                </div>
                            </div>
                            <div className="relative mt-5">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <span className="px-3 py-1 rounded-full bg-white/20 backdrop-blur text-[11px] font-black uppercase tracking-widest border border-white/25">
                                        {hero.title}
                                    </span>
                                    <span className="text-[11px] font-bold text-white/85">{progressPct}% complete</span>
                                </div>
                                <p className="text-[12px] font-medium text-white/85 mt-2">{hero.sub}</p>
                                <div className="mt-3 h-2 rounded-full bg-white/20 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-white to-amber-100 transition-all duration-700"
                                        style={{ width: `${progressPct}%` }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Stepper timeline — connected icons with per-stage
                            descriptions; current step pulses, done steps check. */}
                        <div className="relative flex flex-col gap-7 mt-2">
                            <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-[var(--color-surface-container)]">
                                <div
                                    className="w-full bg-green-500 transition-all duration-700"
                                    style={{ height: activeIndex < 0 ? '0%' : `${Math.min(100, ((activeIndex) / (stages.length - 1)) * 100)}%` }}
                                />
                            </div>

                            {stages.map((stage, index) => {
                                const Icon = stage.icon;
                                const isDone = index < activeIndex || (order?.status === 'DELIVERED' && index === stages.length - 1);
                                const isCurrent = index === activeIndex && order?.status !== 'DELIVERED';

                                return (
                                    <div key={stage.id} className="flex gap-4 items-start relative z-10">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 shrink-0 ${
                                            isCurrent ? 'bg-primary text-white scale-110 shadow-lg shadow-primary/30 ring-4 ring-primary/20' :
                                            isDone ? 'bg-green-500 text-white shadow-md shadow-green-500/30' :
                                            'bg-[var(--color-surface-card)] text-[var(--color-on-surface-variant)] border-2 border-[var(--color-surface-high)]'
                                            }`}>
                                            {isDone && !isCurrent ? <Check size={18} strokeWidth={3} /> : <Icon className="w-5 h-5" />}
                                        </div>
                                        <div className="flex-1 pt-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                <h3 className={`font-black text-sm tracking-tight ${isDone || isCurrent ? 'text-[var(--color-on-surface)]' : 'text-gray-400'}`}>
                                                    {stage.label}
                                                </h3>
                                                {stage.time && (
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDone || isCurrent ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'}`}>
                                                        {fmtStageTime(stage.time)}
                                                    </span>
                                                )}
                                            </div>
                                            <p className={`text-[11px] mt-0.5 ${isCurrent ? 'text-primary font-semibold' : isDone ? 'text-[var(--color-on-surface-variant)]' : 'text-gray-400'}`}>
                                                {isCurrent ? (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                                                        {stage.desc}
                                                    </span>
                                                ) : (
                                                    stage.desc
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {(trackingInfo?.assigned_rider || order?.partner_name) && (
                <div className="glass-card p-5 animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[var(--color-on-surface)] flex items-center gap-2">
                            <Truck className="w-5 h-5 text-primary" /> Delivery Partner
                        </h3>
                        {order?.status === 'OUT_FOR_DELIVERY' && (
                            <div className="flex items-center gap-1">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
                                <span className="text-[10px] font-bold text-green-600 uppercase">Live Tracking</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-black text-lg text-[var(--color-on-surface)]">
                                {trackingInfo?.assigned_rider?.name || order.partner_name}
                            </p>
                            <div className="flex items-center gap-1 text-[var(--color-on-surface-variant)] text-sm mt-1">
                                <Phone className="w-4 h-4" /> {trackingInfo?.assigned_rider?.phone || order.partner_phone}
                            </div>
                        </div>
                        <a href={`tel:${trackingInfo?.assigned_rider?.phone || order.partner_phone}`} className="p-3 bg-green-100 text-green-600 rounded-full hover:bg-green-200 transition-colors shadow-sm">
                            <Phone className="w-5 h-5" />
                        </a>
                    </div>

                    {riderLocation && order?.status === 'OUT_FOR_DELIVERY' && (
                        <div className="mt-2 p-3 bg-primary/5 rounded-xl border border-primary/10 flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400">Rider Distance</span>
                                <span className="text-sm font-black text-primary">
                                    {/* The status endpoint returns the order's coords as
                                        delivery_latitude/delivery_longitude (o.* columns), so
                                        reading plain `latitude`/`longitude` produced NaN. */}
                                    {calculateDistance(riderLocation.latitude, riderLocation.longitude, order?.delivery_latitude ?? order?.latitude, order?.delivery_longitude ?? order?.longitude).toFixed(2)} km away
                                </span>
                            </div>
                            <div className="h-1.5 bg-[var(--color-surface-container)] rounded-full overflow-hidden">
                                <div className="h-full bg-primary animate-pulse" style={{ width: '40%' }}></div>
                            </div>
                            <p className="text-[10px] text-gray-400 text-center italic">Arriving soon at your location</p>
                        </div>
                    )}

                    {routeData && order?.status !== 'DELIVERED' && (
                        <div className="mt-2 p-3 bg-[var(--color-surface-low)] rounded-xl border border-[var(--color-surface-high)] flex flex-col gap-3">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> Optimized Route
                            </h4>
                            <div className="flex items-center justify-between text-[11px]">
                                {routeData.legs.map((leg, idx) => (
                                    <div key={idx} className="flex flex-col items-center flex-1 relative">
                                        <span className="font-bold text-[var(--color-on-surface)]">{leg.from}</span>
                                        <span className="text-[9px] text-primary font-black mt-0.5">{leg.distance}km</span>
                                        <span className="text-[8px] text-gray-400">{leg.time}m</span>
                                        {idx < routeData.legs.length - 1 && (
                                            <div className="absolute top-1.5 -right-2 w-4 h-0.5 bg-primary/20"></div>
                                        )}
                                    </div>
                                ))}
                                <div className="flex flex-col items-center flex-1">
                                    <span className="font-bold text-[var(--color-on-surface)]">{routeData.legs[routeData.legs.length - 1].to}</span>
                                    <span className="text-[9px] text-green-500 font-black mt-0.5">End</span>
                                </div>
                            </div>
                            <div className="flex justify-between items-center text-[10px] pt-1 border-t border-[var(--color-surface-high)]">
                                <span className="text-[var(--color-on-surface-variant)]">Total Optimized Distance</span>
                                <span className="font-black text-[var(--color-on-surface)]">{routeData.total_distance} km</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="glass-card p-5 flex flex-col gap-3">
                <div className="flex items-center gap-3 text-[var(--color-on-surface-variant)]">
                    <MapPin className="w-5 h-5 text-primary" />
                    <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Delivery Address</p>
                        <p className="text-sm font-medium">{order?.delivery_address}</p>
                    </div>
                </div>
                <div className="border-t border-[var(--color-surface-high)] pt-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-[var(--color-on-surface)]">Total Amount</span>
                    <span className="text-lg font-black text-[var(--color-on-surface)]">₹{order?.total_amount}</span>
                </div>
            </div>

            {/* Ordered Products */}
            {Array.isArray(order?.items) && order.items.length > 0 && (
                <div className="glass-card p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-[var(--color-on-surface)] uppercase tracking-tight flex items-center gap-2">
                            <Package className="w-4 h-4 text-primary" /> Items ({order.items.length})
                        </h3>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Qty × Price</span>
                    </div>
                    <div className="flex flex-col divide-y divide-gray-50">
                        {order.items.map((item, idx) => {
                            const img = getItemImage(item);
                            const qty = Number(item.quantity || 1);
                            const price = Number(item.price || 0);
                            const fitting = Number(item.fitting_charge || 0);
                            const lineTotal = (price * qty) + (fitting * qty);
                            return (
                                <div key={idx} className="py-3 flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] overflow-hidden flex items-center justify-center shrink-0 p-1">
                                        {img ? (
                                            <img src={resolveMediaUrl(img)} alt={item.product_name || 'Product'} className="w-full h-full object-contain" loading="lazy" decoding="async" />
                                        ) : (
                                            <Package className="w-6 h-6 text-slate-300" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-black text-[var(--color-on-surface)] truncate">{item.product_name || 'Product'}</p>
                                        {item.device_model && (
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{item.device_model}</p>
                                        )}
                                        <p className="text-[10px] font-bold text-gray-400 mt-0.5">Qty {qty} × ₹{price}{fitting > 0 ? ` + ₹${fitting} fitting` : ''}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-sm font-black text-[var(--color-on-surface)]">₹{lineTotal.toFixed(0)}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Shipment Tracking Section (Shiprocket) */}
            {shipmentData && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4">
                    <div className="glass-card p-5 flex flex-col gap-4 border-l-4 border-l-primary">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-sm font-black text-[var(--color-on-surface)] uppercase tracking-tight">Shipment Details</h3>
                                <p className="text-[10px] font-bold text-gray-400">Via {shipmentData.courier_name}</p>
                            </div>
                            <span className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-black rounded-full uppercase tracking-wider">
                                {shipmentData.current_status}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 py-2 border-y border-gray-50">
                            <div>
                                <p className="text-[9px] font-black text-gray-400 uppercase">AWB Code</p>
                                <p className="text-xs font-bold text-[var(--color-on-surface)]">{shipmentData.awb_code}</p>
                            </div>
                            <div>
                                <p className="text-[9px] font-black text-gray-400 uppercase">Est. Delivery</p>
                                <p className="text-xs font-bold text-[var(--color-on-surface)]">{shipmentData.estimated_delivery || 'Calculating...'}</p>
                            </div>
                        </div>

                        {shipmentData.tracking_url && (
                            <a 
                                href={shipmentData.tracking_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs font-bold text-primary flex items-center gap-1 hover:underline"
                            >
                                Track on courier website <ExternalLink size={12} />
                            </a>
                        )}
                    </div>

                    <div className="glass-card p-6 flex flex-col gap-6">
                        <h3 className="text-sm font-black text-[var(--color-on-surface)] uppercase tracking-tight">Tracking Timeline</h3>
                        
                        <div className="relative flex flex-col gap-8">
                            {/* Vertical Line */}
                            <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-[var(--color-surface-container)]"></div>

                            {shipmentData.events && shipmentData.events.length > 0 ? (
                                shipmentData.events.map((event, idx) => (
                                    <div key={idx} className="flex gap-4 items-start relative z-10">
                                        <div className={`w-4 h-4 rounded-full border-2 ${idx === 0 ? 'bg-primary border-primary ring-4 ring-primary/20' : 'bg-[var(--color-surface-card)] border-[var(--color-surface-high)]'} mt-1`}></div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start">
                                                <h4 className={`text-sm font-black ${idx === 0 ? 'text-[var(--color-on-surface)]' : 'text-[var(--color-on-surface-variant)]'}`}>
                                                    {event.status}
                                                </h4>
                                                <span className="text-[9px] font-bold text-gray-400">
                                                    {event.date}
                                                </span>
                                            </div>
                                            {event.location && (
                                                <p className="text-[10px] font-bold text-gray-400 flex items-center gap-1 mt-0.5">
                                                    <MapPin size={10} /> {event.location}
                                                </p>
                                            )}
                                            <p className="text-[11px] text-[var(--color-on-surface-variant)] mt-1 leading-relaxed">
                                                {event.activity}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-gray-400 italic">No tracking events found yet.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Order Actions Section — also shows for cancelled/terminal orders so
                the status message + relevant actions are never hidden. */}
            {(isOrderInactive || ['PLACED', 'PACKING', 'PACKED', 'PENDING_PAYMENT', 'PENDING', 'DELIVERED'].includes(order?.status)) && (
                <div className="glass-card p-5 flex flex-col gap-4 border-t-4 border-t-red-400">
                    <h3 className="text-sm font-bold text-[var(--color-on-surface)] flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-500" /> Need Help?
                    </h3>

                    {message.text && (
                        <div className={`p-3 rounded-xl text-xs font-bold ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {message.text}
                        </div>
                    )}

                    {['PLACED', 'PACKING', 'PACKED', 'PENDING_PAYMENT', 'PENDING'].includes(order?.status) && (
                        <div className="w-full flex flex-col gap-4">
                            {!showCancelForm ? (
                                <button
                                    onClick={() => setShowCancelForm(true)}
                                    className="w-full py-3 bg-red-50/50 text-red-500 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-50 hover:text-red-600 transition-all border border-red-200/60 shadow-sm"
                                >
                                    <XCircle size={18} /> Want to Cancel?
                                </button>
                            ) : (
                                <form onSubmit={handleCancelSubmit} className="flex flex-col gap-4 p-4 bg-red-50/20 border border-red-100/50 rounded-2xl animate-in slide-in-from-top-3 duration-300">
                                    <div className="flex flex-col gap-1.5 relative">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-red-500 ml-1">Reason for Cancellation</label>
                                        <button
                                            type="button"
                                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                            className="w-full h-12 rounded-xl bg-[var(--color-surface-card)] border border-red-500/20 px-4 text-xs font-bold text-[var(--color-on-surface)] flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-red-400/10 transition-all hover:bg-[var(--color-surface-low)]"
                                        >
                                            <span className={cancelReason ? 'text-[var(--color-on-surface)]' : 'text-slate-400'}>
                                                {cancelReason || "Select cancellation reason..."}
                                            </span>
                                            <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                                        </button>

                                        {isDropdownOpen && (
                                            <div className="mt-1.5 p-1 bg-white/60 backdrop-blur-md border border-red-100/40 rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-inner">
                                                {[
                                                    "Order placed by mistake",
                                                    "Delivery time is too long",
                                                    "Found a better price elsewhere",
                                                    "Changed my mind / No longer need it",
                                                    "Incorrect shipping address selected",
                                                    "Incorrect item/size/model selected",
                                                    "Other"
                                                ].map((reason) => (
                                                    <button
                                                        key={reason}
                                                        type="button"
                                                        onClick={() => {
                                                            setCancelReason(reason);
                                                            setIsDropdownOpen(false);
                                                        }}
                                                        className={`w-full text-left px-4 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                                            cancelReason === reason
                                                            ? 'bg-red-500 text-white'
                                                            : 'text-slate-700 hover:bg-red-50 hover:text-red-500'
                                                        }`}
                                                    >
                                                        <span>{reason}</span>
                                                        {cancelReason === reason && (
                                                            <Check size={14} className="text-white shrink-0" />
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {cancelReason === 'Other' && (
                                        <div className="flex flex-col gap-1.5 animate-in fade-in duration-300">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-red-500 ml-1">Please specify reason</label>
                                            <textarea
                                                value={customReason}
                                                onChange={(e) => setCustomReason(e.target.value)}
                                                required
                                                placeholder="Please tell us why you are cancelling..."
                                                rows="3"
                                                className="w-full p-4 rounded-xl bg-[var(--color-surface-card)] border border-red-500/20 text-xs font-bold text-[var(--color-on-surface)] focus:outline-none focus:ring-2 focus:ring-red-400/10 transition-all resize-none"
                                            />
                                        </div>
                                    )}

                                    <div className="flex gap-3 mt-2">
                                        <button
                                            type="submit"
                                            disabled={actionLoading}
                                            className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-1.5"
                                        >
                                            {actionLoading ? 'Cancelling...' : 'Confirm Cancel'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setShowCancelForm(false); setCancelReason(''); setCustomReason(''); }}
                                            className="px-5 py-3 bg-[var(--color-surface-container)] hover:bg-[var(--color-surface-high)] text-[var(--color-on-surface-variant)] font-bold text-xs uppercase tracking-wider rounded-xl transition-all"
                                        >
                                            Keep Order
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}

                    {order?.status === 'DELIVERED' && !showRefundForm && (
                        <button
                            onClick={() => setShowRefundForm(true)}
                            className="w-full py-3 bg-orange-50 text-orange-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-orange-100 transition-colors border border-orange-200"
                        >
                            <Undo2 size={18} /> Request Refund
                        </button>
                    )}

                    {order?.status === "DELIVERED" && (
                        <Link
                            to={`/profile/complaint?order_id=${orderId}`}
                            className="w-full py-3 bg-indigo-50 text-indigo-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-100 transition-colors border border-indigo-200"
                        >
                            <MessageSquare size={18} /> Report an issue with this order
                        </Link>
                    )}

                    {['DELIVERED', 'COMPLETED'].includes(order?.status?.toUpperCase()) && (
                        <Link
                            to={`/profile/order-report?order_id=${orderId}`}
                            className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-100 transition-colors border border-red-200"
                        >
                            <Flag size={18} /> Report this order
                        </Link>
                    )}

                    {['DELIVERED', 'COMPLETED'].includes(order?.status?.toUpperCase()) && (
                        (() => {
                            const deliveryDate = new Date(order?.status_delivered_at || order?.updated_at || order?.created_at);
                            const now = new Date();
                            const diffDays = Math.ceil((now - deliveryDate) / (1000 * 60 * 60 * 24));
                            const isWithinWindow = diffDays <= 7;

                            if (isWithinWindow) {
                                return (
                                    <Link
                                        to={`/profile/refund-request?order_id=${orderId}`}
                                        className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-100 transition-colors border border-emerald-200"
                                    >
                                        <RotateCcw size={18} /> Refund / Return request
                                    </Link>
                                );
                            } else {
                                return (
                                    <button
                                        disabled
                                        className="w-full py-3 bg-[var(--color-surface-low)] text-gray-400 font-bold rounded-xl flex items-center justify-center gap-2 border border-[var(--color-surface-high)] cursor-not-allowed"
                                    >
                                        <RotateCcw size={18} /> Return window expired
                                    </button>
                                );
                            }
                        })()
                    )}

                    {showRefundForm && (
                        <form onSubmit={handleRefundRequest} className="flex flex-col gap-3 animate-in slide-in-from-top-2">
                            <label className="text-xs font-bold text-[var(--color-on-surface-variant)] uppercase tracking-wider">Reason for Refund</label>
                            <textarea
                                value={refundReason}
                                onChange={(e) => setRefundReason(e.target.value)}
                                required
                                placeholder="E.g. Item damaged, wrong item received..."
                                className="w-full p-3 bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] rounded-xl text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                rows="3"
                            />
                            <div className="flex gap-2">
                                <button
                                    type="submit"
                                    disabled={actionLoading}
                                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl"
                                >
                                    {actionLoading ? 'Submitting...' : 'Submit Request'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowRefundForm(false)}
                                    className="px-4 py-3 bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] font-bold rounded-xl"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}

                    {isOrderInactive && (
                        <div className="flex flex-col items-center gap-2 py-2">
                            <span className={`text-sm font-black ${order?.status?.toUpperCase() === 'CANCELLED' ? 'text-red-500' : 'text-[var(--color-on-surface-variant)]'}`}>Order Status: {(order.status || 'CANCELLED').replace('_', ' ')}</span>
                            <p className="text-[10px] text-center text-gray-400">
                                {order?.status?.toUpperCase() === 'CANCELLED'
                                    ? 'This order has been cancelled and cannot be modified.'
                                    : isPendingRefundRequest
                                        ? 'Your refund request is under review. We will notify you once it is processed.'
                                        : 'This order is no longer active. Contact support if you need help.'}
                            </p>
                            {order?.cancellation_reason && (
                                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-3 py-1">
                                    Reason: {order.cancellation_reason}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            <Link to="/" className="w-full py-4 bg-[var(--color-surface-card)] text-[var(--color-on-surface-variant)] font-bold rounded-2xl text-center shadow-sm hover:shadow-md transition-all border border-[var(--color-surface-high)]">
                Back to Shopping
            </Link>
        </div>
    );
}

export default OrderTracking;
