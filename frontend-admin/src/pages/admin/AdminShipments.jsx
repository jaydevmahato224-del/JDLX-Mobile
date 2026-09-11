import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { Truck, Package, User, MapPin, Calendar, ExternalLink, Search, Filter, Loader2, RefreshCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { apiFetch } from '../../utils/apiFetch'

function AdminShipments() {
    const [shipments, setShipments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const fetchShipments = async () => {
        setLoading(true);
        try {
            const url = new URL(`${API_BASE_URL}/admin/shipment/list`);
            if (statusFilter) url.searchParams.append('status', statusFilter);
            
            // apiFetch expects a string URL — a URL object here would produce a
            // garbage ".../api/api/https://..." path and every request would fail.
            const res = await apiFetch(url.toString());
            const data = await res.json();
            if (res.ok) {
                // Backend wraps in success_response: { success, data, message }
                setShipments(Array.isArray(data?.data) ? data.data : []);
            } else {
                toast.error(data.message || "Failed to load shipments");
            }
        } catch {
            toast.error("Network error while loading shipments");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchShipments();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
    }, [statusFilter]);

    const filteredShipments = shipments.filter(s => 
        String(s.order_id).includes(searchQuery) || 
        s.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.awb_code?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusColor = (status) => {
        const s = status?.toLowerCase();
        if (s?.includes('delivered')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        if (s?.includes('transit') || s?.includes('shipped')) return 'bg-amber-100 text-amber-700 border-amber-200';
        if (s?.includes('rto') || s?.includes('fail') || s?.includes('return')) return 'bg-rose-100 text-rose-700 border-rose-200';
        if (s === 'assigned') return 'bg-blue-100 text-blue-700 border-blue-200';
        return 'bg-slate-100 text-slate-700 border-slate-200';
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-slate-900">Shipment Management</h1>
                    <p className="text-sm font-medium text-slate-500">Track and manage all Shiprocket deliveries</p>
                </div>
                <button 
                    onClick={fetchShipments}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
                >
                    <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Data
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input 
                        type="text" 
                        placeholder="Search by Order ID, Customer, or AWB..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-12 pl-11 pr-4 bg-white border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                </div>

                <div className="relative">
                    <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <select 
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full h-12 pl-11 pr-4 bg-white border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary/20 outline-none appearance-none"
                    >
                        <option value="">All Statuses</option>
                        <option value="created">Created</option>
                        <option value="assigned">Assigned</option>
                        <option value="In Transit">In Transit</option>
                        <option value="Delivered">Delivered</option>
                        <option value="RTO">RTO</option>
                    </select>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Shipment Info</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Customer</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">AWB & Courier</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center">
                                        <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
                                        <p className="text-sm font-bold text-slate-400">Loading shipments...</p>
                                    </td>
                                </tr>
                            ) : filteredShipments.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center text-slate-400 font-bold italic">
                                        No shipments found
                                    </td>
                                </tr>
                            ) : (
                                filteredShipments.map((shipment) => (
                                    <tr key={shipment.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-slate-900">Order #{shipment.order_id}</span>
                                                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 mt-1">
                                                    <Calendar size={10} /> {new Date(shipment.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-slate-800 flex items-center gap-1">
                                                    <User size={14} className="text-slate-400" /> {shipment.customer_name}
                                                </span>
                                                <span className="text-[11px] font-medium text-slate-500 mt-1">₹{shipment.total_amount}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-xs font-black text-slate-900 uppercase tracking-tighter">
                                                    {shipment.awb_code || 'No AWB'}
                                                </span>
                                                <span className="text-[10px] font-bold text-primary uppercase mt-1">
                                                    {shipment.courier_name || 'Not Assigned'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border w-fit ${getStatusColor(shipment.status)}`}>
                                                    {shipment.status}
                                                </span>
                                                {shipment.estimated_delivery && (
                                                    <span className="text-[9px] font-bold text-slate-400 italic">
                                                        Est: {shipment.estimated_delivery}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                {shipment.tracking_url ? (
                                                    <a 
                                                        href={shipment.tracking_url} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                                                        title="Track Shipment"
                                                    >
                                                        <ExternalLink size={16} />
                                                    </a>
                                                ) : (
                                                    <button className="p-2 bg-slate-100 text-slate-400 rounded-lg cursor-not-allowed" disabled>
                                                        <ExternalLink size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default AdminShipments;
