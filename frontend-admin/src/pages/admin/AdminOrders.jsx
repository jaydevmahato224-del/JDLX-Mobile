import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, CheckCircle, Truck, UserPlus, Search, Filter, Eye, X, Package, Clock, Printer, Calendar, MapPin, Map, AlertCircle, RotateCcw, Loader2, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import toast from 'react-hot-toast'

function AdminOrders() {
    const [orders, setOrders] = useState([]);
    const [deliveryPartners, setDeliveryPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [paymentFilter, setPaymentFilter] = useState('all');
    const [dateRange, setDateRange] = useState('all'); // all, today, week, month
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [selectedPartner, setSelectedPartner] = useState('');
    const [shipmentCreating, setShipmentCreating] = useState(false);
    const [courierAssigning, setCourierAssigning] = useState(false);
    const [weight, setWeight] = useState(0.5);
    const navigate = useNavigate();

    const handleCreateShipment = async (orderId) => {
        if (!window.confirm("Create Shiprocket shipment for this order?")) return;
        setShipmentCreating(true);
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/shipment/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ order_id: orderId, weight_kg: weight })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("Shiprocket order created!");
                fetchOrderDetails(orderId);
            } else {
                toast.error(data.message || "Failed to create shipment");
            }
        } catch (err) {
            toast.error("Network error");
        } finally {
            setShipmentCreating(false);
        }
    };

    const handleAssignCourier = async (orderId) => {
        setCourierAssigning(true);
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/shipment/assign-courier/${orderId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(`Assigned: ${data.data.courier_name} (AWB: ${data.data.awb_code})`);
                fetchOrderDetails(orderId);
            } else {
                toast.error(data.message || "Courier assignment failed");
            }
        } catch (err) {
            toast.error("Network error");
        } finally {
            setCourierAssigning(false);
        }
    };

    const fetchOrders = () => {
        setLoading(true);
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        if (!token) return;

        let url = `${API_BASE_URL}/admin/orders?status=${statusFilter}&payment_status=${paymentFilter}`;
        if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;

        // Date logic
        if (dateRange !== 'all') {
            const today = new Date();
            let start = new Date();
            if (dateRange === 'today') {
                start.setHours(0, 0, 0, 0);
            } else if (dateRange === 'week') {
                start.setDate(today.getDate() - 7);
            } else if (dateRange === 'month') {
                start.setMonth(today.getMonth() - 1);
            }
            url += `&start_date=${start.toISOString().split('T')[0]}&end_date=${today.toISOString().split('T')[0]}`;
        }

        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(res => res.json())
            .then(data => {
                setOrders(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    const fetchPartners = () => {
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        if (!token) return;
        fetch(`${API_BASE_URL}/admin/delivery-partners`, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(res => res.json())
            .then(data => setDeliveryPartners(data))
            .catch(console.error);
    };

    // Use polling and initial fetch
    useEffect(() => {
        fetchOrders();
        fetchPartners();
        const interval = setInterval(fetchOrders, 10000); // Live poll every 10s
        return () => clearInterval(interval);
    }, [statusFilter, paymentFilter, searchTerm, dateRange]);

    const fetchOrderDetails = async (orderId) => {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/orders/${orderId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSelectedOrder(data);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const updateStatus = async (orderId, status) => {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/order/${orderId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status })
            });
            if (res.ok) {
                fetchOrders();
                if (selectedOrder && selectedOrder.id === orderId) {
                    fetchOrderDetails(orderId);
                }
            }
        } catch (error) {
            console.error(error);
        }
    };

    const assignPartner = async (orderId) => {
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const payload = selectedPartner ? { delivery_partner_id: selectedPartner } : {};
            const res = await fetch(`${API_BASE_URL}/admin/order/${orderId}/assign-delivery`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Failed to assign partner');
            } else {
                setSelectedPartner('');
                fetchOrders();
                fetchPartners();
                if (selectedOrder && selectedOrder.id === orderId) {
                    fetchOrderDetails(orderId);
                }
            }
        } catch (error) {
            console.error(error);
        }
    };

    const getStatusStyle = (status) => {
        const styles = {
            'placed': 'bg-yellow-100 text-yellow-800',
            'pending': 'bg-yellow-100 text-yellow-800',
            'routing': 'bg-blue-100 text-blue-800 border-blue-200 animate-pulse',
            'waiting_for_partner': 'bg-orange-100 text-orange-800 border-orange-200',
            'store_assigned': 'bg-indigo-100 text-indigo-800',
            'inventory_unavailable': 'bg-red-50 text-red-900 border border-red-200',
            'confirmed': 'bg-blue-100 text-blue-800',
            'packed': 'bg-purple-100 text-purple-800',
            'shipped': 'bg-teal-100 text-teal-800',
            'out_for_delivery': 'bg-teal-100 text-teal-800',
            'delivered': 'bg-green-100 text-green-800',
            'cancelled': 'bg-red-100 text-red-800'
        };
        return styles[status?.toLowerCase()] || 'bg-gray-100 text-gray-800';
    };

    const printInvoice = () => {
        window.print();
    };

    // Analytics computation
    const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === 'pending').length,
        outForDelivery: orders.filter(o => o.status === 'out_for_delivery').length,
        completed: orders.filter(o => o.status === 'delivered').length
    };

    return (
        <div className="py-6 flex flex-col gap-6 relative min-h-screen">
            <div className="flex items-center gap-4">
                <button onClick={() => navigate('/admin')} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-800" />
                </button>
                <h1 className="text-2xl font-bold text-gray-800">Orders Management</h1>
            </div>

            {/* Analytics Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="glass-card p-4 flex flex-col justify-center">
                    <p className="text-sm font-medium text-gray-500">Total Live Orders</p>
                    <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
                </div>
                <div className="glass-card p-4 flex flex-col justify-center bg-yellow-50/50">
                    <p className="text-sm font-medium text-yellow-700">Pending</p>
                    <p className="text-2xl font-bold text-yellow-800">{stats.pending}</p>
                </div>
                <div className="glass-card p-4 flex flex-col justify-center bg-indigo-50/50">
                    <p className="text-sm font-medium text-indigo-700">Out for Delivery</p>
                    <p className="text-2xl font-bold text-indigo-800">{stats.outForDelivery}</p>
                </div>
                <div className="glass-card p-4 flex flex-col justify-center bg-green-50/50">
                    <p className="text-sm font-medium text-green-700">Delivered</p>
                    <p className="text-2xl font-bold text-green-800">{stats.completed}</p>
                </div>
            </div>

            {/* Controls */}
            <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between no-print">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by ID, Name, Phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                    />
                </div>

                <div className="flex flex-wrap gap-4 w-full md:w-auto">
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="flex-1 md:flex-none py-2 px-4 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        <option value="all">All Time</option>
                        <option value="today">Today</option>
                        <option value="week">Last 7 Days</option>
                        <option value="month">Last 30 Days</option>
                    </select>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="flex-1 md:flex-none py-2 px-4 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        <option value="all">All Statuses</option>
                        <option value="PLACED">Placed</option>
                        <option value="pending">Pending</option>
                        <option value="routing">Routing / AI Queue</option>
                        <option value="waiting_for_partner">Waiting For Partner</option>
                        <option value="store_assigned">Assigned to Store</option>
                        <option value="inventory_unavailable">Inventory Error</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="PACKED">Packed</option>
                        <option value="SHIPPED">Shipped</option>
                        <option value="out_for_delivery">Out for Delivery</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
            </div>

            {/* Data Table */}
            <div className="glass-card overflow-hidden no-print">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Order ID</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Customer</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Amount</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Store / Rider</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Shipment</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Status</th>
                                <th className="p-4 font-semibold text-gray-600 text-sm whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i} className="border-b border-gray-50">
                                        <td className="p-4"><div className="h-5 bg-gray-200 rounded animate-pulse w-24"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-200 rounded animate-pulse w-32"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-200 rounded animate-pulse w-16"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-200 rounded animate-pulse w-20"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-200 rounded animate-pulse w-24"></div></td>
                                        <td className="p-4"><div className="h-5 bg-gray-200 rounded animate-pulse w-10"></div></td>
                                    </tr>
                                ))
                            ) : orders.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-gray-500">No orders found matching criteria.</td>
                                </tr>
                            ) : (
                                orders.map(order => (
                                    <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-gray-800 whitespace-nowrap">{order.order_number}</span>
                                                <span className="text-xs text-gray-500 whitespace-nowrap">{new Date(order.created_at).toLocaleString()}</span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className="font-medium text-gray-800">{order.customer_name}</span>
                                                <span className="text-xs text-gray-500">{order.phone}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 whitespace-nowrap">
                                            <div className="flex flex-col gap-1">
                                                <div className="font-bold text-gray-800">
                                                    ₹{order.total_amount}
                                                    <span className="text-[10px] font-normal text-gray-500 ml-1">({order.items_count} items)</span>
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-tight ${
                                                            order.payment_type === 'COD' 
                                                                ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                        }`}>
                                                            {order.payment_type || 'PREPAID'}
                                                        </span>
                                                        
                                                        {['PLACED', 'PENDING', 'CANCELLED', 'REJECTED'].includes(order.status?.toUpperCase()) ? (
                                                            <span className="text-[10px] font-medium text-gray-400 italic">
                                                                {order.status?.toUpperCase() === 'PLACED' ? 'Awaiting Payment' : 'Unrealized'}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-tight">
                                                                ✓ Confirmed
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    {!['PLACED', 'PENDING', 'CANCELLED', 'REJECTED'].includes(order.status?.toUpperCase()) && (
                                                        order.payment_type === 'COD' ? (
                                                            <div className="flex gap-1.5 text-[9px] font-bold mt-0.5">
                                                                <span className="text-emerald-700 bg-emerald-50 px-1 rounded">Paid: ₹{order.cod_advance_paid || 49}</span>
                                                                <span className="text-rose-700 bg-rose-50 px-1 rounded">Due: ₹{order.cod_remaining_amount}</span>
                                                            </div>
                                                        ) : (
                                                            <div className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 rounded w-fit mt-0.5">
                                                                Received: ₹{order.total_amount}
                                                            </div>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1">
                                                {order.dark_store_id ? <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded flex items-center gap-1 w-max"><Package className="w-3 h-3" /> Store #{order.dark_store_id}</span> : <span className="text-xs text-gray-400">-</span>}
                                                {order.delivery_partner_id ? <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded flex items-center gap-1 w-max"><UserPlus className="w-3 h-3" /> Rider #{order.delivery_partner_id}</span> : <span className="text-xs text-gray-400">-</span>}
                                                {order.estimated_delivery && <span className="text-xs text-orange-600 font-medium">ETA: {order.estimated_delivery}</span>}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            {order.shipment_status ? (
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                                    order.shipment_status?.toLowerCase().includes('delivered') ? 'bg-green-100 text-green-700' :
                                                    order.shipment_status === 'assigned' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-amber-100 text-amber-700'
                                                }`}>
                                                    {order.shipment_status}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-400 italic">No Shipment</span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${getStatusStyle(order.status)}`}>
                                                {order.status.replace(/_/g, ' ').toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <button
                                                onClick={() => fetchOrderDetails(order.id)}
                                                className="p-2 text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                                                title="View Details"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Order Details Panel */}
            {selectedOrder && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-opacity">
                    <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col animate-slide-in-right">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <div>
                                <h2 className="text-xl font-bold text-gray-800">{selectedOrder.order_number}</h2>
                                <p className="text-sm text-gray-500">{new Date(selectedOrder.created_at).toLocaleString()}</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={printInvoice} className="p-2 text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2 no-print">
                                    <Printer className="w-4 h-4" /> Print Invoice
                                </button>
                                <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors no-print">
                                    <X className="w-5 h-5 text-gray-600" />
                                </button>
                            </div>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 min-h-0 flex flex-col gap-6">

                            {/* Action Controls */}
                            <div className="flex flex-wrap gap-2 no-print">
                                {['pending', 'inventory_unavailable', 'PLACED'].includes(selectedOrder.order_status) && (
                                    <button onClick={() => updateStatus(selectedOrder.id, 'routing')} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 flex flex-row items-center gap-2"><Map className="w-4 h-4" /> Trigger Auto-Route Engine</button>
                                )}
                                {['store_assigned', 'confirmed', 'PLACED'].includes(selectedOrder.order_status?.toUpperCase()) && (
                                    <button onClick={() => updateStatus(selectedOrder.id, 'PACKED')} className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700">Mark Packed</button>
                                )}
                                {selectedOrder.order_status?.toUpperCase() === 'PACKED' && !selectedOrder.delivery_partner_id && (
                                    <div className="flex bg-gray-100 p-1 rounded-xl">
                                        <select
                                            value={selectedPartner}
                                            onChange={e => setSelectedPartner(e.target.value)}
                                            className="bg-transparent text-sm font-medium focus:outline-none px-2"
                                        >
                                            <option value="">Auto-Assign Partner</option>
                                            {deliveryPartners.map(p => (
                                                <option key={p.id} value={p.id}>{p.name} (Active)</option>
                                            ))}
                                        </select>
                                        <button onClick={() => assignPartner(selectedOrder.id)} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 flex items-center gap-2 shadow-sm"><UserPlus className="w-4 h-4" /> Assign</button>
                                    </div>
                                )}
                                {(selectedOrder.order_status?.toUpperCase() === 'PACKED' || selectedOrder.order_status === 'packed') && selectedOrder.delivery_partner_id && (
                                    <button onClick={() => updateStatus(selectedOrder.id, 'SHIPPED')} className="px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-semibold hover:bg-orange-700 flex items-center gap-2"><Truck className="w-4 h-4" /> Dispatch / Ship</button>
                                )}
                                {(['SHIPPED', 'OUT_FOR_DELIVERY'].includes(selectedOrder.order_status?.toUpperCase()) || selectedOrder.order_status === 'out_for_delivery') && (
                                    <button onClick={() => updateStatus(selectedOrder.id, 'DELIVERED')} className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Mark Delivered</button>
                                )}
                                {['pending', 'confirmed', 'PLACED'].includes(selectedOrder.order_status?.toUpperCase()) && (
                                    <button onClick={() => { if (window.confirm('Are you sure you want to cancel this order?')) updateStatus(selectedOrder.id, 'CANCELLED') }} className="px-4 py-2 text-red-600 bg-red-50 rounded-xl text-sm font-semibold hover:bg-red-100 ml-auto flex items-center gap-2">Cancel</button>
                                )}
                            </div>

                            {/* Status Banner */}
                            <div className={`p-4 rounded-xl flex items-center gap-3 ${getStatusStyle(selectedOrder.order_status)}`}>
                                <Package className="w-6 h-6" />
                                <div>
                                    <p className="font-bold uppercase">{selectedOrder.order_status.replace(/_/g, ' ')}</p>
                                    <p className="text-sm opacity-90">
                                        {selectedOrder.delivery_partner_id
                                            ? `Assigned to Partner #${selectedOrder.delivery_partner_id}`
                                            : 'Waiting for assignment'}
                                    </p>
                                </div>
                            </div>

                            {/* Shipment Management Section */}
                            <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-col gap-4 shadow-xl border border-slate-800 no-print">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                                    <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                        <Truck className="w-4 h-4 text-indigo-400" /> Shiprocket Management
                                    </h3>
                                    {selectedOrder.shipment_status && (
                                        <span className="px-2 py-0.5 bg-indigo-500 text-white text-[9px] font-black rounded-full uppercase">
                                            {selectedOrder.shipment_status}
                                        </span>
                                    )}
                                </div>

                                {!selectedOrder.shiprocket_order_id ? (
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1">
                                                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Package Weight (KG)</p>
                                                <input 
                                                    type="number" 
                                                    value={weight} 
                                                    onChange={e => setWeight(e.target.value)}
                                                    step="0.1"
                                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                                />
                                            </div>
                                            <button 
                                                onClick={() => handleCreateShipment(selectedOrder.id)}
                                                disabled={shipmentCreating || selectedOrder.order_status?.toLowerCase() !== 'confirmed'}
                                                className="mt-5 h-10 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg text-xs font-black uppercase transition-all flex items-center gap-2"
                                            >
                                                {shipmentCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3 h-3" />}
                                                Create Order
                                            </button>
                                        </div>
                                        {selectedOrder.order_status?.toLowerCase() !== 'confirmed' && (
                                            <p className="text-[10px] font-bold text-rose-400 italic">* Order must be CONFIRMED to create shipment</p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-3 bg-slate-800 rounded-xl border border-slate-700">
                                                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">SR Order ID</p>
                                                <p className="text-xs font-bold text-indigo-300">{selectedOrder.shiprocket_order_id}</p>
                                            </div>
                                            <div className="p-3 bg-slate-800 rounded-xl border border-slate-700">
                                                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">AWB Code</p>
                                                <p className="text-xs font-bold text-emerald-400">{selectedOrder.awb_code || 'PENDING'}</p>
                                            </div>
                                        </div>

                                        {!selectedOrder.awb_code ? (
                                            <button 
                                                onClick={() => handleAssignCourier(selectedOrder.id)}
                                                disabled={courierAssigning}
                                                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                                            >
                                                {courierAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                                                Auto-Assign Courier & AWB
                                            </button>
                                        ) : (
                                            <div className="flex flex-col gap-2">
                                                <div className="p-3 bg-slate-800 rounded-xl border border-slate-700 flex justify-between items-center">
                                                    <div>
                                                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Courier Partner</p>
                                                        <p className="text-xs font-bold text-white">{selectedOrder.courier_name}</p>
                                                    </div>
                                                    {selectedOrder.tracking_url && (
                                                        <a 
                                                            href={selectedOrder.tracking_url} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-indigo-400 transition-colors"
                                                        >
                                                            <ExternalLink size={14} />
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Customer Details */}
                            <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2">
                                <h3 className="font-bold border-b border-gray-200 pb-2 mb-2 text-gray-800">Customer Details</h3>
                                <p className="text-sm"><strong>Name:</strong> {selectedOrder.customer_name}</p>
                                <p className="text-sm"><strong>Phone:</strong> {selectedOrder.customer_phone}</p>
                                <p className="text-sm"><strong>Address:</strong> {selectedOrder.delivery_address}</p>
                                {selectedOrder.delivery_latitude && (
                                    <p className="text-xs text-gray-500 font-mono flex items-center gap-1 mt-1"><MapPin className="w-3 h-3" /> {selectedOrder.delivery_latitude}, {selectedOrder.delivery_longitude}</p>
                                )}
                            </div>

                            {/* Phase 10: Routing Topology Map */}
                            {selectedOrder.dark_store_id && (
                                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4 flex flex-col gap-4">
                                    <h3 className="font-bold text-indigo-900 border-b border-blue-200 pb-2 flex items-center gap-2">
                                        <Map className="w-4 h-4" /> Live AI Routing Vector
                                    </h3>
                                    <div className="flex items-center justify-between text-sm relative">
                                        <div className="absolute left-1/2 top-4 w-11/12 h-0.5 bg-blue-200 -translate-x-1/2 -z-10 boundary-dashed"></div>

                                        <div className="flex flex-col items-center gap-2 bg-white p-3 rounded-lg shadow-sm border border-blue-100 z-10 w-28">
                                            <Package className="w-6 h-6 text-indigo-600" />
                                            <span className="font-bold text-center leading-tight">Dark Store<br />#{selectedOrder.dark_store_id}</span>
                                        </div>

                                        <div className="flex flex-col items-center gap-2 bg-white p-3 rounded-lg shadow-sm border border-blue-100 z-10 w-28">
                                            {selectedOrder.delivery_partner_id ? <Truck className="w-6 h-6 text-orange-500" /> : <AlertCircle className="w-6 h-6 text-red-500 animate-pulse" />}
                                            <span className="font-bold text-center leading-tight text-orange-700">Rider<br />{selectedOrder.delivery_partner_id ? `#${selectedOrder.delivery_partner_id}` : 'PENDING'}</span>
                                        </div>

                                        <div className="flex flex-col items-center gap-2 bg-white p-3 rounded-lg shadow-sm border border-blue-100 z-10 w-28">
                                            <MapPin className="w-6 h-6 text-green-600" />
                                            <span className="font-bold text-center leading-tight text-green-700">Customer<br />Dropoff</span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between mt-2 pt-2 border-t border-blue-200">
                                        <span className="text-xs font-semibold text-blue-800">Haversine Engine Mode: ACTIVE</span>
                                        <span className="text-xs font-bold text-orange-600">ETA: {selectedOrder.estimated_delivery}</span>
                                    </div>
                                </div>
                            )}

                            {/* Order Items */}
                            <div className="flex flex-col gap-2">
                                <h3 className="font-bold border-b border-gray-200 pb-2 text-gray-800">Order Items</h3>
                                <div className="flex flex-col gap-3 mt-2">
                                    {(selectedOrder.items || []).map(item => (
                                        <div key={item.id} className="flex flex-col gap-1 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <p className="font-bold text-sm text-gray-800">{item.product_name}</p>
                                                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-tight">
                                                        Qty: {item.quantity} × ₹{item.price}
                                                    </p>
                                                    {item.device_model && (
                                                        <p className="text-[10px] font-black text-primary uppercase mt-0.5">Model: {item.device_model}</p>
                                                    )}
                                                </div>
                                                <p className="font-bold text-gray-800">₹{item.price * item.quantity}</p>
                                            </div>
                                            {item.fitting_charge > 0 && (
                                                <div className="flex justify-between items-center pt-1 border-t border-gray-200/50 mt-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <Truck size={12} className="text-emerald-600" />
                                                        <span className="text-[10px] font-black text-emerald-700 uppercase">Fitting Service</span>
                                                    </div>
                                                    <span className="text-[11px] font-bold text-emerald-700">+ ₹{item.fitting_charge * item.quantity}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Billing Breakdown */}
                                <div className="space-y-2 mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                    <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                                        <span>Items Subtotal</span>
                                        <span>₹{(selectedOrder.total_amount - (selectedOrder.delivery_fee || 0) - (selectedOrder.platform_fee || 0) - (selectedOrder.fitting_charge || 0)).toLocaleString()}</span>
                                    </div>
                                    {selectedOrder.fitting_charge > 0 && (
                                        <div className="flex justify-between text-xs font-black text-emerald-600 uppercase tracking-widest">
                                            <span>Fitting Service Total</span>
                                            <span>₹{selectedOrder.fitting_charge.toLocaleString()}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                                        <span>Delivery Fee</span>
                                        <span>₹{selectedOrder.delivery_fee || 0}</span>
                                    </div>
                                    <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                                        <span>Platform Fee</span>
                                        <span>₹{selectedOrder.platform_fee || 0}</span>
                                    </div>
                                    <div className="flex justify-between items-center pt-3 border-t-2 border-dashed border-slate-200 mt-2">
                                        <p className="font-black text-slate-900 uppercase tracking-tight">Final Total</p>
                                        <div className="text-right">
                                            <p className="font-black text-2xl text-primary tracking-tighter">₹{selectedOrder.total_amount.toLocaleString()}</p>
                                            <div className="flex gap-2 justify-end mt-1">
                                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${selectedOrder.payment_type === 'COD' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                                                    {selectedOrder.payment_type || 'PREPAID'}
                                                </span>
                                                {selectedOrder.free_delivery_applied === 1 && (
                                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 uppercase tracking-widest">
                                                        Free Delivery Applied
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {selectedOrder.payment_type === 'COD' && (
                                        <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 gap-4">
                                            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                                                <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Advance Paid</p>
                                                <p className="text-lg font-black text-amber-900">₹{selectedOrder.cod_advance_paid || 0}</p>
                                            </div>
                                            <div className="p-3 rounded-xl bg-slate-100 border border-slate-200">
                                                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Remaining COD</p>
                                                <p className="text-lg font-black text-slate-900">₹{selectedOrder.cod_remaining_amount || 0}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Visual Timeline */}
                            <div className="flex flex-col gap-2 relative">
                                <h3 className="font-bold border-b border-gray-200 pb-2 mb-2 text-gray-800">Order Timeline</h3>
                                <div className="relative pl-6 space-y-4 border-l-2 border-gray-100 ml-3">
                                    <div className="relative">
                                        <div className="absolute -left-7 top-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow"></div>
                                        <p className="font-bold text-sm text-gray-800">Placed</p>
                                        <p className="text-xs text-gray-500">{new Date(selectedOrder.created_at).toLocaleString()}</p>
                                    </div>
                                    {selectedOrder.confirmed_at && (
                                        <div className="relative">
                                            <div className="absolute -left-7 top-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white shadow"></div>
                                            <p className="font-bold text-sm text-gray-800">Confirmed</p>
                                            <p className="text-xs text-gray-500">{new Date(selectedOrder.confirmed_at).toLocaleString()}</p>
                                        </div>
                                    )}
                                    {selectedOrder.packed_at && (
                                        <div className="relative">
                                            <div className="absolute -left-7 top-1 w-3 h-3 bg-purple-500 rounded-full border-2 border-white shadow"></div>
                                            <p className="font-bold text-sm text-gray-800">Packed</p>
                                            <p className="text-xs text-gray-500">{new Date(selectedOrder.packed_at).toLocaleString()}</p>
                                        </div>
                                    )}
                                    {selectedOrder.shipped_at && (
                                        <div className="relative">
                                            <div className="absolute -left-7 top-1 w-3 h-3 bg-teal-500 rounded-full border-2 border-white shadow"></div>
                                            <p className="font-bold text-sm text-gray-800">Shipped</p>
                                            <p className="text-xs text-gray-500">{new Date(selectedOrder.shipped_at).toLocaleString()}</p>
                                        </div>
                                    )}
                                    {selectedOrder.out_for_delivery_at && (
                                        <div className="relative">
                                            <div className="absolute -left-7 top-1 w-3 h-3 bg-indigo-500 rounded-full border-2 border-white shadow"></div>
                                            <p className="font-bold text-sm text-gray-800">Out for Delivery</p>
                                            <p className="text-xs text-gray-500">{new Date(selectedOrder.out_for_delivery_at).toLocaleString()}</p>
                                        </div>
                                    )}
                                    {selectedOrder.delivered_at && (
                                        <div className="relative">
                                            <div className="absolute -left-7 top-1 w-3 h-3 bg-green-600 rounded-full border-2 border-white shadow scale-125"></div>
                                            <p className="font-bold text-sm text-green-700">Delivered</p>
                                            <p className="text-xs text-gray-500">{new Date(selectedOrder.delivered_at).toLocaleString()}</p>
                                        </div>
                                    )}
                                    {selectedOrder.cancelled_at && (
                                        <div className="relative">
                                            <div className="absolute -left-7 top-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow scale-125"></div>
                                            <p className="font-bold text-sm text-red-700">Cancelled</p>
                                            <p className="text-xs text-gray-500">{new Date(selectedOrder.cancelled_at).toLocaleString()}</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}

export default AdminOrders
