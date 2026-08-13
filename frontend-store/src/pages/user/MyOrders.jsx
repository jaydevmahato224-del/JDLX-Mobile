import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { Link } from 'react-router-dom'
import { MapPin, ChevronRight } from 'lucide-react'

function MyOrders() {
    const token = useStore.getState().token;
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/user/orders`, { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) setOrders(await res.json());
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchOrders();
    }, [token]);

    if (loading) return <div>Loading orders...</div>;

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">My Orders</h2>
            {orders.length === 0 ? (
                <p>No orders placed yet.</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {orders.map(order => (
                        <Link
                            key={order.id}
                            to={`/track/${order.id}`}
                            className="glass-card p-4 flex flex-col gap-3 hover:translate-y-[-2px] transition-all hover:shadow-lg group"
                        >
                            <div className="flex justify-between items-start">
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
                                        order.shipment_status === 'DELIVERED' || order.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                                        ['IN_TRANSIT', 'SHIPPED', 'In Transit'].includes(order.shipment_status) ? 'bg-orange-100 text-orange-700' :
                                        order.shipment_status === 'assigned' ? 'bg-blue-100 text-blue-700' :
                                        ['RTO', 'RETURNED'].includes(order.shipment_status) ? 'bg-red-100 text-red-700' :
                                        order.status === 'OUT_FOR_DELIVERY' ? 'bg-blue-100 text-blue-700' :
                                        order.status === 'PACKING' ? 'bg-purple-100 text-purple-700' :
                                        'bg-yellow-100 text-yellow-700'
                                    }`}>
                                        {order.shipment_status || order.status}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                    <MapPin className="w-3 h-3" />
                                    <span className="truncate max-w-[180px]">{order.delivery_address}</span>
                                </div>
                                <div className="flex items-center gap-1 text-primary font-bold text-xs group-hover:gap-2 transition-all">
                                    Track Order <ChevronRight className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}

export default MyOrders
