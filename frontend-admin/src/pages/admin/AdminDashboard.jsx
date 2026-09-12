import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag, Users, TrendingUp, Package, ShieldAlert, History, Megaphone, Undo2, MessageSquare, Warehouse, Truck, Check, ClipboardList, AlertTriangle } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import adminLogo from '../../assets/admin-logo.svg'
import { apiFetch } from '../../utils/apiFetch'

// Onboarding source -> label/emoji/color used by the acquisition chart.
const SOURCE_META = {
    friends: { label: 'Friends & Family', emoji: '👨‍👩‍👧‍👦', color: '#22c55e' },
    relatives: { label: 'Relatives', emoji: '👪', color: '#8b5cf6' },
    social_media: { label: 'Social Media', emoji: '📱', color: '#f59e0b' },
    other: { label: 'Other', emoji: '💡', color: '#64748b' },
};
const PLATFORM_META = {
    whatsapp: { label: '💬 WhatsApp', color: '#22c55e' },
    instagram: { label: '📸 Instagram', color: '#e1306c' },
    facebook: { label: '👍 Facebook', color: '#3b82f6' },
    youtube: { label: '▶️ YouTube', color: '#ef4444' },
};

// Order lifecycle stage -> badge colour for the status breakdown.
const STATUS_META = {
    PLACED: { color: '#f59e0b', label: 'Placed' },
    CONFIRMED: { color: '#3b82f6', label: 'Confirmed' },
    PACKING: { color: '#a855f7', label: 'Packing' },
    PACKED: { color: '#6366f1', label: 'Packed' },
    OUT_FOR_DELIVERY: { color: '#0ea5e9', label: 'Out for Delivery' },
    SHIPPED: { color: '#8b5cf6', label: 'Shipped' },
    DELIVERED: { color: '#22c55e', label: 'Delivered' },
    CANCELLED: { color: '#ef4444', label: 'Cancelled' },
    REJECTED: { color: '#ef4444', label: 'Rejected' },
    RETURNED: { color: '#f97316', label: 'Returned' },
    REFUNDED: { color: '#f97316', label: 'Refunded' },
};

function AdminDashboard() {
    const [stats, setStats] = useState({
        total_users: 0,
        low_stock_count: 0
    });
    const [recentOrders, setRecentOrders] = useState([]);
    const [systemStats, setSystemStats] = useState({
        total_orders: 0,
        daily_revenue: 0
    });
    const [securityAlerts, setSecurityAlerts] = useState({
        blocked_ips: [],
        suspicious_activity: [],
        failed_login_attempts: []
    });
    // Real multi-vendor operational snapshot (statuses, pending work, stock).
    const [pulse, setPulse] = useState({
        order_status_breakdown: [],
        pending_actions: { refunds: 0, complaints: 0, warehouse_requests: 0, delivery_requests: 0 },
        warehouse_low_stock: 0,
        total_products: 0
    });
    // Where new users say they heard about JDLX Mobile (first-run onboarding)
    const [sourceStats, setSourceStats] = useState({ sources: [], platforms: [], total: 0, days: 90 });

    useEffect(() => {
        apiFetch('/admin/stats')
            .then(res => res.json())
            .then(result => {
                const data = result.data || result;
                if (!data.error) setStats(prev => ({ ...prev, ...data }))
            })
            .catch(err => console.error(err));

        apiFetch('/admin/system-stats')
            .then(res => res.json())
            .then(result => {
                const data = result.data || result;
                if (!data.error) setSystemStats(prev => ({ ...prev, ...data }))
            })
            .catch(err => console.error(err));

        apiFetch('/admin/dashboard-pulse')
            .then(res => res.json())
            .then(result => {
                const data = result.data || result;
                if (!data.error) setPulse(prev => ({ ...prev, ...data }))
            })
            .catch(err => console.error(err));

        apiFetch('/admin/security-alerts')
            .then(res => res.json())
            .then(result => {
                const data = result.data || result;
                if (!data.error) setSecurityAlerts(data)
            })
            .catch(err => console.error(err));

        apiFetch('/admin/recent-orders')
            .then(res => res.json())
            .then(result => {
                const data = Array.isArray(result) ? result : (result.data || []);
                if (!data.error) setRecentOrders(data)
            })
            .catch(err => console.error(err));

        apiFetch('/admin/analytics/onboarding-sources')
            .then(res => res.json())
            .then(result => {
                const data = result.data || result;
                if (!data.error) setSourceStats(data)
            })
            .catch(err => console.error(err));
    }, []);

    const totalOrders = systemStats.total_orders || 0;
    const statusBars = (pulse.order_status_breakdown || [])
        .map(s => ({ ...s, ...(STATUS_META[s.status] || { color: '#94a3b8', label: s.status }) }))
        .sort((a, b) => b.count - a.count);

    return (
        <div className="py-6 flex flex-col gap-8 md:py-8">
            <h1 className="ui-h2 flex items-center gap-3">
                <img src={adminLogo} alt="Logo" className="w-9 h-9 rounded-xl p-1 bg-primary/10 shadow-sm" />
                <span className="font-black">JDLX Official Admin Panel</span>
            </h1>

            {/* KPI row — real counts from live tables */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="ui-card-premium p-5 flex flex-col gap-2 transition-all hover:scale-[1.02] hover:shadow-xl">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                        <ShoppingBag className="w-5 h-5" />
                    </div>
                    <p className="ui-label mt-2">Total Orders</p>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{totalOrders}</h2>
                </div>

                <div className="glass-card p-4 flex flex-col gap-2">
                    <div className="w-8 h-8 bg-green-100 text-green-600 rounded-lg flex items-center justify-center">
                        <TrendingUp className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Revenue (Today)</p>
                    <h2 className="text-2xl font-black text-gray-800">₹{systemStats.daily_revenue || 0}</h2>
                </div>

                <div className="glass-card p-4 flex flex-col gap-2">
                    <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Total Products</p>
                    <h2 className="text-2xl font-black text-gray-800">{pulse.total_products || 0}</h2>
                </div>

                <div className="glass-card p-4 flex flex-col gap-2">
                    <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center">
                        <Users className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Total Users</p>
                    <h2 className="text-2xl font-black text-gray-800">{stats.total_users || 0}</h2>
                </div>

                <Link to="/admin/inventory" className="glass-card p-4 flex flex-col gap-2 hover:bg-white/60 transition-colors">
                    <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center">
                        <Warehouse className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Warehouse Low Stock</p>
                    <h2 className={`text-2xl font-black ${(pulse.warehouse_low_stock || 0) > 0 ? 'text-red-600' : 'text-gray-800'}`}>{pulse.warehouse_low_stock || 0}</h2>
                </Link>

                <Link to="/admin/inventory" className="glass-card p-4 flex flex-col gap-2 hover:bg-white/60 transition-colors border-red-100 bg-red-50/20">
                    <div className="w-8 h-8 bg-red-100 text-red-600 rounded-lg flex items-center justify-center">
                        <ShieldAlert className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Catalog Low Stock</p>
                    <h2 className="text-2xl font-black text-red-600">{stats.low_stock_count || 0}</h2>
                </Link>
            </div>

            {/* Pending actions — what needs an admin decision right now */}
            <div className="ui-card-premium p-6 md:p-8 flex flex-col gap-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-500/10 rounded-xl">
                        <ClipboardList className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                        <h3 className="ui-h2 text-gray-900">Pending Actions</h3>
                        <p className="text-xs text-gray-500 font-medium mt-0.5">Things waiting for your decision</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                        { to: '/admin/refunds', icon: Undo2, label: 'Refund Requests', value: pulse.pending_actions?.refunds || 0, tone: 'amber' },
                        { to: '/admin/complaints', icon: MessageSquare, label: 'Open Complaints', value: pulse.pending_actions?.complaints || 0, tone: 'rose' },
                        { to: '/admin/warehouse-applications', icon: Warehouse, label: 'Warehouse Requests', value: pulse.pending_actions?.warehouse_requests || 0, tone: 'indigo' },
                        { to: '/admin/delivery-applications', icon: Truck, label: 'Delivery Requests', value: pulse.pending_actions?.delivery_requests || 0, tone: 'blue' },
                    ].map(item => {
                        const tones = {
                            amber: 'bg-amber-50 border-amber-100 text-amber-600',
                            rose: 'bg-rose-50 border-rose-100 text-rose-600',
                            indigo: 'bg-indigo-50 border-indigo-100 text-indigo-600',
                            blue: 'bg-blue-50 border-blue-100 text-blue-600',
                        };
                        return (
                            <Link key={item.to} to={item.to} className={`p-5 rounded-3xl border flex flex-col gap-2 transition-all hover:scale-[1.02] hover:shadow-md ${tones[item.tone]}`}>
                                <item.icon className="w-5 h-5" />
                                <span className="text-3xl font-black tracking-tighter leading-none">{item.value}</span>
                                <span className="text-[10px] font-black uppercase tracking-widest opacity-70">{item.label}</span>
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Order status breakdown — where every order currently sits */}
            <div className="ui-card-premium p-6 md:p-8 flex flex-col gap-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-xl">
                        <ShoppingBag className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                        <h3 className="ui-h2 text-gray-900">Order Status Breakdown</h3>
                        <p className="text-xs text-gray-500 font-medium mt-0.5">All {totalOrders} orders by current stage</p>
                    </div>
                </div>
                {statusBars.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
                        {statusBars.map(s => {
                            const pct = totalOrders ? Math.round((s.count / totalOrders) * 100) : 0;
                            return (
                                <div key={s.status}>
                                    <div className="flex items-center justify-between text-sm mb-1.5">
                                        <span className="font-bold text-gray-700">{s.label}</span>
                                        <span className="text-gray-500 font-semibold">{s.count} · {pct}%</span>
                                    </div>
                                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="py-10 text-center rounded-3xl border-2 border-dashed border-gray-200">
                        <p className="text-sm font-bold text-gray-500">No orders yet</p>
                    </div>
                )}
            </div>

            {/* Where users come from (onboarding acquisition) */}
            <div className="ui-card-premium p-6 md:p-8 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/10 rounded-xl">
                            <Megaphone className="w-6 h-6 text-amber-500" />
                        </div>
                        <div>
                            <h3 className="ui-h2 text-gray-900">How Users Find Us</h3>
                            <p className="text-xs text-gray-500 font-medium mt-0.5">Where new users heard about JDLX Mobile (last {sourceStats.days || 90} days)</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-amber-50 border border-amber-200/60">
                        <span className="text-2xl font-black text-amber-600 tracking-tighter">{sourceStats.total || 0}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Users</span>
                    </div>
                </div>

                {sourceStats.sources?.length ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                        {/* Donut of sources */}
                        <div className="relative h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={sourceStats.sources.map(s => ({
                                            name: (SOURCE_META[s.source] || {}).label || s.source,
                                            value: s.count,
                                            color: (SOURCE_META[s.source] || {}).color || '#94a3b8',
                                        }))}
                                        dataKey="value"
                                        nameKey="name"
                                        innerRadius={62}
                                        outerRadius={92}
                                        paddingAngle={3}
                                        strokeWidth={0}
                                    >
                                        {sourceStats.sources.map((s, i) => (
                                            <Cell key={s.source || i} fill={(SOURCE_META[s.source] || {}).color || '#94a3b8'} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600 }} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-3xl font-black text-gray-900 tracking-tighter">{sourceStats.total || 0}</span>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total</span>
                            </div>
                        </div>

                        {/* Source breakdown bars */}
                        <div className="flex flex-col gap-4">
                            {sourceStats.sources.map(s => {
                                const meta = SOURCE_META[s.source] || { label: s.source, emoji: '•', color: '#94a3b8' };
                                const pct = sourceStats.total ? Math.round((s.count / sourceStats.total) * 100) : 0;
                                return (
                                    <div key={s.source}>
                                        <div className="flex items-center justify-between text-sm mb-1.5">
                                            <span className="font-bold text-gray-700">{meta.emoji} {meta.label}</span>
                                            <span className="text-gray-500 font-semibold">{s.count} · {pct}%</span>
                                        </div>
                                        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: meta.color }} />
                                        </div>
                                    </div>
                                )
                            })}

                            {/* Social platform split (when social media picked) */}
                            {sourceStats.platforms?.length > 0 && (
                                <div className="mt-3 pt-4 border-t border-gray-100">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Social Media Breakdown</p>
                                    <div className="flex flex-wrap gap-2">
                                        {sourceStats.platforms.map(p => (
                                            <span key={p.platform} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border bg-white"
                                                style={{ color: (PLATFORM_META[p.platform] || {}).color || '#64748b', borderColor: 'rgba(0,0,0,0.06)' }}>
                                                {(PLATFORM_META[p.platform] || {}).label || p.platform}
                                                <span className="text-gray-400 font-black">{p.count}</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="py-12 text-center rounded-3xl border-2 border-dashed border-gray-200">
                        <p className="text-3xl mb-2">📣</p>
                        <p className="text-sm font-bold text-gray-500">No data yet</p>
                        <p className="text-xs text-gray-400 mt-1">This chart fills in once users complete the onboarding question.</p>
                    </div>
                )}
            </div>

            {/* Security & System Health — compact, real signals */}
            <div className="ui-card-premium p-6 md:p-8 flex flex-col gap-5 border-red-100/30 bg-red-50/5">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/10 rounded-xl">
                        <ShieldAlert className="w-6 h-6 text-red-500" />
                    </div>
                    <h3 className="ui-h2 text-gray-900">Security & System Health</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <Link to="/admin/system-health" className="p-5 bg-white/40 rounded-3xl border border-red-100/50 shadow-sm hover:bg-white/70 transition-colors">
                        <p className="ui-label text-red-500">Blocked IPs</p>
                        <p className="text-3xl font-black text-red-600 tracking-tighter mt-1">{securityAlerts.blocked_ips?.length || 0}</p>
                    </Link>
                    <Link to="/admin/system-health" className="p-5 bg-white/40 rounded-3xl border border-amber-100/50 shadow-sm hover:bg-white/70 transition-colors">
                        <p className="ui-label text-amber-600">Suspicious Activity</p>
                        <p className="text-3xl font-black text-amber-600 tracking-tighter mt-1">{securityAlerts.suspicious_activity?.length || 0}</p>
                    </Link>
                    <Link to="/admin/system-health" className="p-5 bg-white/40 rounded-3xl border border-indigo-100/50 shadow-sm hover:bg-white/70 transition-colors">
                        <p className="ui-label text-indigo-600">Failed Login Attempts</p>
                        <p className="text-3xl font-black text-indigo-600 tracking-tighter mt-1">{securityAlerts.failed_login_attempts?.length || 0}</p>
                    </Link>
                </div>
            </div>

            {/* Recent orders — live feed */}
            <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <History className="w-5 h-5 text-primary" /> Recent Orders
                    </h3>
                    <Link to="/admin/orders" className="text-xs font-black uppercase tracking-wider text-primary hover:underline">
                        View all →
                    </Link>
                </div>
                <div className="flex flex-col gap-3">
                    {recentOrders.length > 0 ? recentOrders.map((order, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-white/40 rounded-xl border border-white/20">
                            <div className="flex flex-col">
                                <p className="font-bold text-sm text-gray-700">{order.user_name}</p>
                                <p className="text-[10px] text-gray-400 font-bold uppercase">₹{order.total_amount} • {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                            <div className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${order.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                                    order.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                                        'bg-blue-100 text-blue-700'
                                }`}>
                                {order.status}
                            </div>
                        </div>
                    )) : (
                        <p className="text-sm text-gray-500 py-4 text-center">No recent orders</p>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AdminDashboard
