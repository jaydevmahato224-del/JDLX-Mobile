import { useState, useEffect, useCallback } from 'react'
import { 
    ShoppingBag, 
    Search, 
    Filter, 
    ChevronRight, 
    Loader2, 
    MapPin, 
    CheckCircle2, 
    XCircle,
    Clock,
    Phone,
    Package,
    Truck,
    AlertCircle,
    ArrowRight
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

const WarehouseOrders = () => {
    const { warehouseToken, warehouseLogout } = useStore()
    const [orders, setOrders] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState('all')
    const [deliveryTypeFilter, setDeliveryTypeFilter] = useState('all')
    const [updatingId, setUpdatingId] = useState(null)
    const [notification, setNotification] = useState(null)

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type })
        setTimeout(() => setNotification(null), 3000)
    }

    const fetchOrders = useCallback(async () => {
        if (!warehouseToken) return
        setLoading(true)
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/orders`, {
                headers: { Authorization: `Bearer ${warehouseToken}` }
            })
            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                return
            }
            if (!response.ok) throw new Error('Failed to fetch orders')
            const data = await response.json()
            setOrders(data.data || [])
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setLoading(false)
        }
    }, [warehouseToken, warehouseLogout])

    useEffect(() => {
        fetchOrders()
    }, [fetchOrders])

    const handleUpdateStatus = async (assignmentId, newStatus) => {
        if (!warehouseToken) return
        setUpdatingId(assignmentId)
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/orders/${assignmentId}/status`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: newStatus })
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Status update failed')
            
            showNotification(`Order marked as ${newStatus}`)
            await fetchOrders()
        } catch (err) {
            showNotification(err.message, 'error')
        } finally {
            setUpdatingId(null)
        }
    }

    const filteredOrders = orders.filter(order => {
        const matchesSearch = 
            order.order_id.toString().includes(searchQuery) || 
            order.delivery_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
            order.items?.toLowerCase().includes(searchQuery.toLowerCase())
        
        const matchesStatus = filterStatus === 'all' || order.assignment_status === filterStatus
        const matchesType = deliveryTypeFilter === 'all' || order.delivery_type === deliveryTypeFilter
        
        return matchesSearch && matchesStatus && matchesType
    })

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

    if (loading && orders.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium">Loading orders...</p>
            </div>
        )
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
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

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-black text-white tracking-tight flex items-center gap-4">
                        <ShoppingBag className="text-amber-500" size={36} />
                        Order Management
                    </h1>
                    <p className="text-slate-400 mt-2 font-medium">Manage and fulfill customer purchases in real-time.</p>
                </div>

                <div className="flex items-center gap-3">
                    <button 
                        onClick={fetchOrders}
                        className="p-4 rounded-2xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                        title="Refresh Orders"
                    >
                        <Clock size={20} />
                    </button>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { label: 'Pending', count: orders.filter(o => ['assigned', 'accepted', 'packing'].includes(o.assignment_status) && o.order_status?.toUpperCase() !== 'CANCELLED').length, icon: Clock, color: 'text-amber-500' },
                    { label: 'Ready to Ship', count: orders.filter(o => o.assignment_status === 'packed' && o.order_status?.toUpperCase() !== 'CANCELLED').length, icon: Package, color: 'text-emerald-500' },
                    { label: 'Dispatched', count: orders.filter(o => o.assignment_status === 'dispatched' && o.order_status?.toUpperCase() !== 'CANCELLED').length, icon: Truck, color: 'text-blue-500' },
                    { label: 'Total Assigned', count: orders.length, icon: ShoppingBag, color: 'text-slate-400' }
                ].map((stat, idx) => (
                    <div key={idx} className="warehouse-panel p-6 border-white/5 bg-slate-900/40 backdrop-blur-xl">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{stat.label}</p>
                                <h3 className="text-3xl font-black text-white mt-1">{stat.count}</h3>
                            </div>
                            <div className={`p-4 rounded-2xl bg-white/5 ${stat.color}`}>
                                <stat.icon size={24} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters & Search */}
            <div className="warehouse-panel p-4 border-white/5 bg-slate-900/40 backdrop-blur-xl flex flex-col md:flex-row items-center gap-4">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input 
                        type="text"
                        placeholder="Search by Order ID, address, or items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-950/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all"
                    />
                </div>
                
                <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar pb-1 md:pb-0">
                    <div className="h-8 w-px bg-white/10 mx-2 hidden md:block" />
                    <div className="flex items-center gap-2">
                        {['all', 'quick', 'scheduled'].map(type => (
                            <button
                                key={type}
                                onClick={() => setDeliveryTypeFilter(type)}
                                className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all whitespace-nowrap ${
                                    deliveryTypeFilter === type 
                                    ? 'bg-primary text-slate-950 border-primary shadow-lg shadow-primary/20' 
                                    : 'bg-white/5 text-slate-400 border-white/5 hover:border-white/10'
                                }`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>

                    <div className="h-8 w-px bg-white/10 mx-2 hidden md:block" />
                    
                    <div className="flex items-center gap-2">
                        {['all', 'assigned', 'accepted', 'packing', 'packed', 'dispatched', 'cancelled'].map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all whitespace-nowrap ${
                                    filterStatus === status 
                                    ? 'bg-amber-400 text-slate-950 border-amber-400' 
                                    : 'bg-white/5 text-slate-400 border-white/5 hover:border-white/10'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Orders Table/List */}
            <div className="warehouse-panel border-white/5 bg-slate-900/40 backdrop-blur-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Order Detail</th>
                                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Items</th>
                                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Total</th>
                                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Status</th>
                                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 text-right">Operations</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredOrders.length > 0 ? filteredOrders.map((order) => (
                                <tr key={order.id} className="group hover:bg-white/[0.02] transition-colors">
                                    <td className="px-6 py-6">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black text-white">#ORD-{order.order_id}</span>
                                                <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter border ${
                                                    order.delivery_type === 'quick' 
                                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                                    : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                                }`}>
                                                    {order.delivery_type === 'quick' ? '⚡ Quick' : '🗓️ Scheduled'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-slate-500">
                                                <MapPin size={12} />
                                                <span className="text-[10px] font-bold truncate max-w-[200px]">{order.delivery_address}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-slate-500 mt-1">
                                                <Clock size={12} />
                                                <span className="text-[10px] font-bold uppercase tracking-tighter">
                                                    {new Date(order.created_at).toLocaleString()}
                                                </span>
                                            </div>
                                            {order.order_status?.toUpperCase() === 'CANCELLED' && order.cancellation_reason && (
                                                <div className="flex items-center gap-2 text-rose-500 mt-1.5 animate-in fade-in duration-300">
                                                    <AlertCircle size={12} />
                                                    <span className="text-[10px] font-black uppercase tracking-tighter">Reason: {order.cancellation_reason}</span>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-6">
                                        <div className="max-w-[300px]">
                                            <p className="text-xs font-bold text-slate-300 line-clamp-2 italic leading-relaxed">
                                                {order.items}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 text-[9px] font-black text-slate-500 uppercase tracking-tight border border-white/5">
                                                    <Package size={10} /> {order.total_quantity} Units
                                                </div>
                                                {Number(order.has_custom_cutting) === 1 && (
                                                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-400/10 text-[9px] font-black text-amber-300 uppercase tracking-tight border border-amber-400/20">
                                                        Custom Cutting Required
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-6">
                                        <span className="text-sm font-black text-amber-400">₹{order.total_amount}</span>
                                    </td>
                                    <td className="px-6 py-6">
                                        <span className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest ${getStatusColor(order.assignment_status)}`}>
                                            {order.assignment_status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-6 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {(order.assignment_status?.toUpperCase() === 'CANCELLED' || order.order_status?.toUpperCase() === 'CANCELLED') ? (
                                                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[9px] font-black text-rose-400 uppercase tracking-widest">
                                                    <XCircle size={12} /> Cancelled by User
                                                </div>
                                            ) : order.assignment_status === 'assigned' && (
                                                <>
                                                    <button 
                                                        onClick={() => handleUpdateStatus(order.id, 'accepted')}
                                                        disabled={!!updatingId}
                                                        className="h-10 px-4 rounded-xl bg-emerald-500 text-slate-950 text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                                                    >
                                                        Accept
                                                    </button>
                                                    <button 
                                                        onClick={() => handleUpdateStatus(order.id, 'rejected')}
                                                        disabled={!!updatingId}
                                                        className="h-10 px-4 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500/20 transition-all disabled:opacity-50"
                                                    >
                                                        Reject
                                                    </button>
                                                </>
                                            )}
                                            
                                            {order.assignment_status === 'accepted' && (
                                                <button 
                                                    onClick={() => handleUpdateStatus(order.id, 'packing')}
                                                    disabled={!!updatingId}
                                                    className="h-10 px-6 rounded-xl bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                                                >
                                                    Start Packing <ArrowRight size={14} />
                                                </button>
                                            )}

                                            {order.assignment_status === 'packing' && (
                                                <button 
                                                    onClick={() => handleUpdateStatus(order.id, 'packed')}
                                                    disabled={!!updatingId}
                                                    className="h-10 px-6 rounded-xl bg-purple-500 text-white text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-2 shadow-lg shadow-purple-500/20"
                                                >
                                                    Mark Packed <CheckCircle2 size={14} />
                                                </button>
                                            )}

                                            {order.assignment_status === 'packed' && (
                                                <button 
                                                    onClick={() => handleUpdateStatus(order.id, 'dispatched')}
                                                    disabled={!!updatingId}
                                                    className="h-10 px-6 rounded-xl bg-emerald-500 text-slate-950 text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                                                >
                                                    Dispatch <Truck size={14} />
                                                </button>
                                            )}

                                            {['dispatched', 'rejected'].includes(order.assignment_status) && (
                                                <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                                                    No actions available
                                                </div>
                                            )}
                                            
                                            {updatingId === order.id && (
                                                <Loader2 size={16} className="text-amber-400 animate-spin" />
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4 opacity-30">
                                            <AlertCircle size={48} className="text-slate-500" />
                                            <div className="space-y-1">
                                                <p className="text-sm font-black text-white uppercase tracking-widest">No matching orders found</p>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Adjust your filters or wait for new assignments</p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                
                <div className="p-6 border-t border-white/5 bg-slate-950/20 flex items-center justify-between">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        Showing {filteredOrders.length} of {orders.length} assigned orders
                    </p>
                    <div className="flex items-center gap-2">
                        <button disabled className="p-2 rounded-lg bg-white/5 text-slate-600 disabled:opacity-30">
                            <ChevronRight size={16} className="rotate-180" />
                        </button>
                        <button disabled className="p-2 rounded-lg bg-white/5 text-slate-600 disabled:opacity-30">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default WarehouseOrders
