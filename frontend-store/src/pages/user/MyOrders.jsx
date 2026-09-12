import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { Link, useNavigate } from 'react-router-dom'
import { MapPin, ChevronRight, CreditCard, Download } from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'
import { loadRazorpay } from '../../utils/loadRazorpay'
import { downloadOrderInvoice, invoiceAvailable } from '../../utils/downloadInvoice'
import { toast } from 'react-hot-toast'

function MyOrders() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [payingOrderId, setPayingOrderId] = useState(null);
    const [invoiceBusyId, setInvoiceBusyId] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const res = await apiFetch('/user/orders');
                if (res.ok) setOrders(await res.json());
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchOrders();
    }, []);

    // An order needs payment recovery when it was created but never confirmed:
    // still PLACED with payment_status 'pending' — the state left behind when
    // the gateway step fails or the Razorpay modal is dismissed at checkout.
    const needsPayment = (order) =>
        (order.status || '').toUpperCase() === 'PLACED' &&
        (order.payment_status || 'pending').toLowerCase() === 'pending';

    const handleCompletePayment = async (order) => {
        if (payingOrderId) return;
        setPayingOrderId(order.id);
        try {
            const res = await apiFetch('/payment/retry', {
                method: 'POST',
                body: JSON.stringify({ order_id: order.id })
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
                description: `Order #${order.order_number || order.id}`,
                order_id: paymentData.razorpay_order_id,
                prefill: {
                    contact: order.customer_phone || ''
                },
                theme: { color: '#6366f1' },
                handler: async (response) => {
                    try {
                        const verifyRes = await apiFetch('/payment/verify', {
                            method: 'POST',
                            body: JSON.stringify({
                                order_id: order.id,
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature
                            })
                        });
                        if (verifyRes.ok) {
                            toast.success('Payment successful! Your order is confirmed.');
                            navigate(`/track/${order.id}`);
                        } else {
                            const err = await verifyRes.json().catch(() => ({}));
                            toast.error(err?.message || 'Payment verification failed');
                        }
                    } catch (e) {
                        console.error('Verification error:', e);
                        toast.error('Payment verification encountered an error');
                    }
                },
                modal: {
                    ondismiss: () => {
                        setPayingOrderId(null);
                        toast.error('Payment cancelled — you can retry from My Orders');
                    }
                }
            });
            rzp.on('payment.failed', () => {
                setPayingOrderId(null);
                toast.error('Payment failed. Please try again.');
            });
            rzp.open();
        } catch (e) {
            console.error('Retry payment error:', e);
            toast.error(e.message || 'Something went wrong');
            setPayingOrderId(null);
        }
    };

    // Loading state: skeleton cards that mirror the order-card layout so the
    // page doesn't jump when orders arrive. Top padding keeps this block clear
    // of the floating back button, so the two never overlap.
    if (loading) return (
        <div className="pt-14 md:pt-16">
            <div className="h-7 w-36 rounded-lg bg-gray-100 animate-pulse mb-4" />
            <div className="flex flex-col gap-4">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="glass-card p-4 flex flex-col gap-3 animate-pulse">
                        <div className="flex justify-between items-start">
                            <div className="space-y-2">
                                <div className="h-3 w-24 rounded bg-gray-100" />
                                <div className="h-2.5 w-32 rounded bg-gray-50" />
                                <div className="h-4 w-16 rounded bg-gray-100" />
                            </div>
                            <div className="h-6 w-20 rounded-full bg-gray-100" />
                        </div>
                        <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <div className="h-2.5 w-40 rounded bg-gray-50" />
                            <div className="h-3 w-16 rounded bg-gray-100" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">My Orders</h2>
            {orders.length === 0 ? (
                <p>No orders placed yet.</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {orders.map(order => {
                        const showPayNow = needsPayment(order);
                        const statusUpper = (order.status || '').toUpperCase();
                        return (
                        <div
                            key={order.id}
                            className="glass-card p-4 flex flex-col gap-3 hover:translate-y-[-2px] transition-all hover:shadow-lg group"
                        >
                            <Link
                                to={`/track/${order.id}`}
                                className="flex justify-between items-start"
                            >
                                <div>
                                    <div className="text-xs font-black text-primary uppercase tracking-wider mb-1">
                                        #{order.order_number || `ORD-${order.id}`}
                                    </div>
                                    <div className="text-[10px] text-gray-400 font-medium mb-2">
                                        Placed: {new Date(order.created_at).toLocaleString('en-IN', {
                                            dateStyle: 'medium',
                                            timeStyle: 'short'
                                        })}
                                    </div>
                                    <div className="text-sm font-bold text-gray-800">₹{order.total_amount}</div>
                                </div>
                                <div className="flex gap-2 items-center">
                                    {/* (delivery-type badge removed — quick delivery is retired;
                                        all orders use standard scheduled fulfillment.) */}
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                        order.shipment_status === 'DELIVERED' || statusUpper === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                                        statusUpper === 'CANCELLED' || ['RTO', 'RETURNED', 'CANCELLED'].includes(order.shipment_status) ? 'bg-red-100 text-red-700' :
                                        ['IN_TRANSIT', 'SHIPPED', 'In Transit'].includes(order.shipment_status) ? 'bg-orange-100 text-orange-700' :
                                        order.shipment_status === 'assigned' ? 'bg-blue-100 text-blue-700' :
                                        statusUpper === 'OUT_FOR_DELIVERY' ? 'bg-blue-100 text-blue-700' :
                                        statusUpper === 'PACKING' ? 'bg-purple-100 text-purple-700' :
                                        'bg-yellow-100 text-yellow-700'
                                    }`}>
                                        {order.shipment_status || order.status}
                                    </span>
                                </div>
                            </Link>

                            {showPayNow && (
                                <button
                                    onClick={() => handleCompletePayment(order)}
                                    disabled={payingOrderId === order.id}
                                    className={`w-full py-3 rounded-2xl font-black text-sm tracking-tight flex items-center justify-center gap-2 transition-all ${
                                        payingOrderId === order.id
                                            ? 'bg-gray-200 text-gray-400'
                                            : 'bg-primary text-white hover:scale-[1.01] active:scale-[0.99]'
                                    }`}
                                >
                                    <CreditCard className="w-4 h-4" />
                                    {payingOrderId === order.id ? 'Opening payment…' : 'Complete Payment'}
                                </button>
                            )}

                            <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                    <MapPin className="w-3 h-3" />
                                    <span className="truncate max-w-[180px]">{order.delivery_address}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    {invoiceAvailable(order.created_at) && (
                                        <button
                                            onClick={() => downloadOrderInvoice(order.id, {
                                                setBusy: (b) => setInvoiceBusyId(b ? order.id : null),
                                                filename: `${order.order_number || `ORD-${order.id}`}-invoice.pdf`
                                            })}
                                            disabled={invoiceBusyId === order.id}
                                            className="flex items-center gap-1 text-primary font-bold text-xs disabled:opacity-50"
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                            {invoiceBusyId === order.id ? 'Preparing…' : 'Invoice'}
                                        </button>
                                    )}
                                    <Link
                                        to={`/track/${order.id}`}
                                        className="flex items-center gap-1 text-primary font-bold text-xs group-hover:gap-2 transition-all"
                                    >
                                        Track Order <ChevronRight className="w-3.5 h-3.5" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}
        </div>
    )
}

export default MyOrders
