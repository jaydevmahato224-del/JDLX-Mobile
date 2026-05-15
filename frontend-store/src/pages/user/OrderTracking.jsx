import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Package, Truck, CheckCircle, Clock, MapPin, Phone, XCircle, Undo2, AlertCircle, MessageSquare, Flag, RotateCcw } from 'lucide-react'
import { API_BASE_URL } from '../../config'

function OrderTracking() {
    const { orderId } = useParams();
    const [order, setOrder] = useState(null);
    const [error, setError] = useState(null);
    const [trackingInfo, setTrackingInfo] = useState(null);
    const [riderLocation, setRiderLocation] = useState(null);
    const [routeData, setRouteData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [refundReason, setRefundReason] = useState('');
    const [showRefundForm, setShowRefundForm] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

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
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE_URL}/order/${orderId}/tracking`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setTrackingInfo(data);
                }
            } catch (err) {
                console.error('Failed to fetch tracking info');
            }
        };

        const fetchStatus = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE_URL}/order/${orderId}/status`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setOrder(data);
                    fetchTracking(); // Fetch streamlined tracking info too
                } else {
                    setError('Order not found or access denied.');
                }
            } catch (err) {
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
                    const token = localStorage.getItem('token');
                    const res = await fetch(`${API_BASE_URL}/order/${orderId}/rider-location`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setRiderLocation(data);
                    }
                } catch (err) {
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
                    const token = localStorage.getItem('token');
                    const res = await fetch(`${API_BASE_URL}/order/${orderId}/route`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setRouteData(data);
                    }
                } catch (err) {
                    console.error('Failed to fetch route info');
                }
            };
            fetchRoute();
            routeInterval = setInterval(fetchRoute, 15000); // Poll route every 15s
        }
        return () => clearInterval(routeInterval);
    }, [order?.delivery_partner_id, order?.status, orderId]);

    const handleCancel = async () => {
        if (!window.confirm("Are you sure you want to cancel this order?")) return;
        setActionLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/order/${orderId}/cancel`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: "Order cancelled successfully." });
                setOrder(prev => ({ ...prev, status: 'CANCELLED' }));
            } else {
                setMessage({ type: 'error', text: data.error || "Failed to cancel order." });
            }
        } catch (err) {
            setMessage({ type: 'error', text: "An error occurred." });
        } finally {
            setActionLoading(false);
        }
    };

    const handleRefundRequest = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/order/${orderId}/refund-request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
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
        } catch (err) {
            setMessage({ type: 'error', text: "An error occurred." });
        } finally {
            setActionLoading(false);
        }
    };

    const stages = [
        { id: 'PLACED', label: 'Order Placed', icon: Clock, time: order?.created_at },
        { id: 'PACKED', label: 'Packed', icon: Package, time: order?.packed_at },
        { id: 'SHIPPED', label: 'Shipped', icon: Truck, time: order?.shipped_at },
        { id: 'DELIVERED', label: 'Delivered', icon: CheckCircle, time: order?.delivered_at }
    ];

    const getCurrentStageIndex = () => {
        return stages.findIndex(s => s.id === order?.status);
    };

    if (loading) return <div className="p-10 text-center text-gray-500">Tracking your order...</div>;
    if (error) return (
        <div className="p-10 text-center flex flex-col items-center gap-4 text-gray-500">
            <p>{error}</p>
            <Link to="/" className="text-primary font-bold">Back to Home</Link>
        </div>
    );

    const activeIndex = getCurrentStageIndex();

    return (
        <div className="container-standard py-6 flex flex-col gap-6">
            <div className="flex items-center gap-4">
                <Link to="/" className="p-2 hover:bg-white/40 rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                </Link>
                <h1 className="text-2xl font-bold text-gray-800">Track Order #{orderId}</h1>
            </div>

            <div className="glass-card p-6 flex flex-col gap-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Truck className="w-24 h-24 text-primary" />
                </div>

                <div className="flex flex-col">
                    <div className="text-sm font-bold text-gray-400 uppercase tracking-wider">Estimated Delivery</div>
                    <div className="text-3xl font-black text-primary">
                        {order?.status === 'DELIVERED' ? 'Delivered' : (trackingInfo?.estimated_delivery_time || order?.estimated_delivery)}
                    </div>
                </div>

                <div className="relative flex flex-col gap-8 mt-4">
                    {/* Vertical Line */}
                    <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-gray-100"></div>

                    {stages.map((stage, index) => {
                        const Icon = stage.icon;
                        const isCompleted = index <= activeIndex;
                        const isCurrent = index === activeIndex;

                        return (
                            <div key={stage.id} className="flex gap-4 items-start relative z-10">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${isCurrent ? 'bg-primary text-white scale-110 shadow-lg ring-4 ring-primary/20' :
                                    isCompleted ? 'bg-green-500 text-white' : 'bg-white text-gray-300 border-2 border-gray-50'
                                    }`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <div className="flex-1 pt-1">
                                    <h3 className={`font-bold text-sm ${isCompleted ? 'text-gray-800' : 'text-gray-400'}`}>
                                        {stage.label}
                                    </h3>
                                    {stage.time && (
                                        <p className="text-[10px] text-gray-400">
                                            {new Date(stage.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    )}
                                    {isCurrent && stage.id !== 'DELIVERED' && (
                                        <p className="text-[11px] text-primary font-medium mt-1 animate-pulse">
                                            In Progress...
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {(trackingInfo?.assigned_rider || order?.partner_name) && (
                <div className="glass-card p-5 animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
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
                            <p className="font-black text-lg text-gray-900">
                                {trackingInfo?.assigned_rider?.name || order.partner_name}
                            </p>
                            <div className="flex items-center gap-1 text-gray-500 text-sm mt-1">
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
                                    {calculateDistance(riderLocation.latitude, riderLocation.longitude, order.latitude, order.longitude).toFixed(2)} km away
                                </span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-primary animate-pulse" style={{ width: '40%' }}></div>
                            </div>
                            <p className="text-[10px] text-gray-400 text-center italic">Arriving soon at your location</p>
                        </div>
                    )}

                    {routeData && order?.status !== 'DELIVERED' && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-col gap-3">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> Optimized Route
                            </h4>
                            <div className="flex items-center justify-between text-[11px]">
                                {routeData.legs.map((leg, idx) => (
                                    <div key={idx} className="flex flex-col items-center flex-1 relative">
                                        <span className="font-bold text-gray-800">{leg.from}</span>
                                        <span className="text-[9px] text-primary font-black mt-0.5">{leg.distance}km</span>
                                        <span className="text-[8px] text-gray-400">{leg.time}m</span>
                                        {idx < routeData.legs.length - 1 && (
                                            <div className="absolute top-1.5 -right-2 w-4 h-0.5 bg-primary/20"></div>
                                        )}
                                    </div>
                                ))}
                                <div className="flex flex-col items-center flex-1">
                                    <span className="font-bold text-gray-800">{routeData.legs[routeData.legs.length - 1].to}</span>
                                    <span className="text-[9px] text-green-500 font-black mt-0.5">End</span>
                                </div>
                            </div>
                            <div className="flex justify-between items-center text-[10px] pt-1 border-t border-gray-100">
                                <span className="text-gray-500">Total Optimized Distance</span>
                                <span className="font-black text-gray-800">{routeData.total_distance} km</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="glass-card p-5 flex flex-col gap-3">
                <div className="flex items-center gap-3 text-gray-700">
                    <MapPin className="w-5 h-5 text-primary" />
                    <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Delivery Address</p>
                        <p className="text-sm font-medium">{order?.delivery_address}</p>
                    </div>
                </div>
                <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-800">Total Amount</span>
                    <span className="text-lg font-black text-gray-900">₹{order?.total_amount}</span>
                </div>
            </div>

            {/* Order Actions Section */}
            {(['PLACED', 'PACKING', 'PENDING_PAYMENT', 'DELIVERED'].includes(order?.status)) && (
                <div className="glass-card p-5 flex flex-col gap-4 border-t-4 border-t-red-400">
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-500" /> Need Help?
                    </h3>

                    {message.text && (
                        <div className={`p-3 rounded-xl text-xs font-bold ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {message.text}
                        </div>
                    )}

                    {['PLACED', 'PACKING', 'PENDING_PAYMENT'].includes(order?.status) && (
                        <button
                            onClick={handleCancel}
                            disabled={actionLoading}
                            className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-100 transition-colors border border-red-200"
                        >
                            <XCircle size={18} /> {actionLoading ? 'Processing...' : 'Cancel Order'}
                        </button>
                    )}

                    {order?.status === 'DELIVERED' && !showRefundForm && (
                        <button
                            onClick={() => setShowRefundForm(true)}
                            className="w-full py-3 bg-orange-50 text-orange-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-orange-100 transition-colors border border-orange-200"
                        >
                            <Undo2 size={18} /> Request Refund
                        </button>
                    )}

                    <Link
                        to={`/profile/complaint?order_id=${orderId}`}
                        className="w-full py-3 bg-indigo-50 text-indigo-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-100 transition-colors border border-indigo-200"
                    >
                        <MessageSquare size={18} /> Report an issue with this order
                    </Link>

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
                                        className="w-full py-3 bg-gray-50 text-gray-400 font-bold rounded-xl flex items-center justify-center gap-2 border border-gray-100 cursor-not-allowed"
                                    >
                                        <RotateCcw size={18} /> Return window expired
                                    </button>
                                );
                            }
                        })()
                    )}

                    {showRefundForm && (
                        <form onSubmit={handleRefundRequest} className="flex flex-col gap-3 animate-in slide-in-from-top-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Reason for Refund</label>
                            <textarea
                                value={refundReason}
                                onChange={(e) => setRefundReason(e.target.value)}
                                required
                                placeholder="E.g. Item damaged, wrong item received..."
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:outline-none"
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
                                    className="px-4 py-3 bg-gray-100 text-gray-500 font-bold rounded-xl"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}

                    {['CANCELLED', 'REFUND_REQUESTED', 'REFUNDED'].includes(order?.status) && (
                        <div className="flex flex-col items-center gap-2 py-4 italic text-gray-400">
                            <span className="text-sm font-medium">Order Status: {order.status.replace('_', ' ')}</span>
                            <p className="text-[10px] text-center">Refer to our help center for more details</p>
                        </div>
                    )}
                </div>
            )}

            <Link to="/" className="w-full py-4 bg-white text-gray-600 font-bold rounded-2xl text-center shadow-sm hover:shadow-md transition-all border border-gray-100">
                Back to Shopping
            </Link>
        </div>
    );
}

export default OrderTracking;
