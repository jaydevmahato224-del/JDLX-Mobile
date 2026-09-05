import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag, Users, TrendingUp, Package, FolderTree, Truck, Warehouse, Check, Undo2, RefreshCw, BarChart3, ShieldCheck, KeyRound, History, ShieldAlert, HardDriveDownload, LifeBuoy, Megaphone } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { API_BASE_URL } from '../../config'
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

function AdminDashboard() {
    const [stats, setStats] = useState({
        total_orders: 0,
        total_revenue: 0,
        total_users: 0,
        total_products: 0,
        low_stock_count: 0
    });
    const [recentOrders, setRecentOrders] = useState([]);
    const [systemStats, setSystemStats] = useState({
        total_users: 0,
        total_orders: 0,
        active_delivery_partners: 0,
        low_stock_products: 0,
        daily_revenue: 0
    });
    const [warehouseStats, setWarehouseStats] = useState({
        store_stats: [],
        low_stock_alerts: []
    });
    const [securityAlerts, setSecurityAlerts] = useState({
        blocked_ips: [],
        suspicious_activity: [],
        failed_login_attempts: []
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

        apiFetch('/admin/warehouse-analytics')
            .then(res => res.json())
            .then(result => {
                const data = result.data || result;
                if (!data.error) setWarehouseStats(data)
            })
            .catch(err => console.error(err));

        apiFetch('/admin/system-stats')
            .then(res => res.json())
            .then(result => {
                const data = result.data || result;
                if (!data.error) setSystemStats(data)
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

    return (
        <div className="py-6 flex flex-col gap-8 md:py-8">
            <h1 className="ui-h2 flex items-center gap-3">
                <img src={adminLogo} alt="Logo" className="w-9 h-9 rounded-xl p-1 bg-primary/10 shadow-sm" />
                <span className="font-black">JDLX Official Admin Panel</span>
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-5">
                <div className="ui-card-premium p-6 flex flex-col gap-2 transition-all hover:scale-[1.02] hover:shadow-xl">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                        <ShoppingBag className="w-5 h-5" />
                    </div>
                    <p className="ui-label mt-2">Total Orders</p>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{systemStats.total_orders || stats.total_orders}</h2>
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
                    <h2 className="text-2xl font-black text-gray-800">{stats.total_products || 0}</h2>
                </div>

                <div className="glass-card p-4 flex flex-col gap-2">
                    <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center">
                        <Users className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Total Users</p>
                    <h2 className="text-2xl font-black text-gray-800">{stats.total_users || 0}</h2>
                </div>

                <div className="glass-card p-4 flex flex-col gap-2">
                    <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center">
                        <Truck className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Active Riders</p>
                    <h2 className="text-2xl font-black text-gray-800">{systemStats.active_delivery_partners || 0}</h2>
                </div>

                <div className="glass-card p-4 flex flex-col gap-2 border-red-100 bg-red-50/20">
                    <div className="w-8 h-8 bg-red-100 text-red-600 rounded-lg flex items-center justify-center">
                        <ShieldAlert className="w-5 h-5" />
                    </div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Low Stock</p>
                    <h2 className="text-2xl font-black text-red-600">{systemStats.low_stock_products || stats.low_stock_count}</h2>
                </div>
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

            <div className="ui-card-premium p-8 flex flex-col gap-5 border-red-100/30 bg-red-50/5">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/10 rounded-xl">
                        <ShieldAlert className="w-6 h-6 text-red-500" />
                    </div>
                    <h3 className="ui-h2 text-gray-900">Security & System Health</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="p-5 bg-white/40 rounded-3xl border border-red-100/50 shadow-sm">
                        <p className="ui-label text-red-500">Blocked IPs</p>
                        <p className="text-3xl font-black text-red-600 tracking-tighter mt-1">{securityAlerts.blocked_ips?.length || 0}</p>
                    </div>
                    <div className="p-5 bg-white/40 rounded-3xl border border-amber-100/50 shadow-sm">
                        <p className="ui-label text-amber-600">Suspicious Activity</p>
                        <p className="text-3xl font-black text-amber-600 tracking-tighter mt-1">{securityAlerts.suspicious_activity?.length || 0}</p>
                    </div>
                    <div className="p-5 bg-white/40 rounded-3xl border border-indigo-100/50 shadow-sm">
                        <p className="ui-label text-indigo-600">Failed Login Attempts</p>
                        <p className="text-3xl font-black text-indigo-600 tracking-tighter mt-1">{securityAlerts.failed_login_attempts?.length || 0}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mt-4">
                <Link to="/admin/orders" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Manage Orders</h3>
                        <p className="text-sm text-gray-500">View and update order status</p>
                    </div>
                    <ShoppingBag className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/inventory" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-gray-800">Inventory Management</h3>
                            {stats.low_stock_count > 0 && (
                                <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse">
                                    {stats.low_stock_count} LOW
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-gray-500">Update stock levels and thresholds</p>
                    </div>
                    <Package className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/categories" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Manage Categories</h3>
                        <p className="text-sm text-gray-500">Create and edit product categories</p>
                    </div>
                    <FolderTree className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/delivery" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Delivery Partners</h3>
                        <p className="text-sm text-gray-500">Manage fleet and assignments</p>
                    </div>
                    <Truck className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/stores" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Dark Stores</h3>
                        <p className="text-sm text-gray-500">Satellite warehouses & local stock</p>
                    </div>
                    <Warehouse className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/restocking" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group border-2 border-primary/20 bg-primary/5">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-gray-800">Replenishment</h3>
                            <span className="px-1.5 py-0.5 bg-primary text-white text-[8px] font-black uppercase rounded">New</span>
                        </div>
                        <p className="text-sm text-gray-500">Auto-restock & supplier requests</p>
                    </div>
                    <RefreshCw className="w-8 h-8 text-primary group-hover:rotate-180 transition-transform duration-700" />
                </Link>

                <Link to="/admin/refunds" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Refunds</h3>
                        <p className="text-sm text-gray-500">Approve and process requests</p>
                    </div>
                    <Undo2 className="w-8 h-8 text-primary group-hover:-rotate-45 transition-transform" />
                </Link>

                <Link to="/admin/admins" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Admin Management</h3>
                        <p className="text-sm text-gray-500">View, create and remove admins</p>
                    </div>
                    <ShieldCheck className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/permissions" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Permission Management</h3>
                        <p className="text-sm text-gray-500">Assign or remove admin permissions</p>
                    </div>
                    <KeyRound className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/activity-logs" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Activity Logs</h3>
                        <p className="text-sm text-gray-500">Track admin actions and system changes</p>
                    </div>
                    <History className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/audit-logs" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Audit Logs</h3>
                        <p className="text-sm text-gray-500">Security-grade admin audit history</p>
                    </div>
                    <ShieldAlert className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/backups" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">System Backups</h3>
                        <p className="text-sm text-gray-500">Create, view and download backup archives</p>
                    </div>
                    <HardDriveDownload className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                </Link>

                <Link to="/admin/recovery" className="glass-card p-6 hover:bg-white/60 transition-colors flex items-center justify-between group border border-red-200 bg-red-50/30">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Disaster Recovery</h3>
                        <p className="text-sm text-gray-500">Verify backups and restore system after failures</p>
                    </div>
                    <LifeBuoy className="w-8 h-8 text-red-500 group-hover:scale-110 transition-transform" />
                </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                <div className="glass-card p-6 lg:col-span-1">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-primary" /> Orders by Warehouse
                    </h3>
                    <div className="flex flex-col gap-3">
                        {(warehouseStats.store_stats || []).length > 0 ? (warehouseStats.store_stats || []).map((store, idx) => (
                            <div key={idx} className="flex flex-col gap-3 p-4 bg-white/50 rounded-2xl border border-white/40 shadow-sm transition-all hover:shadow-md hover:bg-white/80">
                                <div className="flex items-start justify-between">
                                    <div className="flex flex-col gap-1">
                                        <p className="font-black text-gray-900 border-l-4 border-primary pl-3 tracking-tight">{store.name}</p>
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-[10px] font-black text-emerald-700 uppercase tracking-tighter">₹{Math.round(store.daily_sales || 0)} (24h)</span>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase">Rev: ₹{Math.round(store.total_revenue || 0)}</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xl font-black text-primary leading-none">{store.total_orders}</p>
                                        <p className="text-[9px] text-gray-400 uppercase font-black tracking-tight">Lifetime</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div className="flex items-center gap-2 bg-slate-50/50 p-2 rounded-xl border border-slate-100/50">
                                        <div className="p-1.5 bg-blue-100/50 rounded-lg">
                                            <Truck className="w-3.5 h-3.5 text-blue-600" />
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black text-blue-700/60 uppercase leading-none mb-0.5">Riders</p>
                                            <p className="text-xs font-black text-blue-800 tracking-tight">{store.assigned_riders || 0} Free</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-slate-50/50 p-2 rounded-xl border border-slate-100/50">
                                        <div className="p-1.5 bg-amber-100/50 rounded-lg">
                                            <ShoppingBag className="w-3.5 h-3.5 text-amber-600" />
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black text-amber-700/60 uppercase leading-none mb-0.5">Processing</p>
                                            <p className="text-xs font-black text-amber-800 tracking-tight">{store.active_orders || 0} Orders</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )) : (
                            <p className="text-sm text-gray-500 py-4 text-center">No warehouse data available</p>
                        )}
                    </div>
                </div>

                <div className="glass-card p-6 lg:col-span-1">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <History className="w-5 h-5 text-primary" /> Recent Orders
                    </h3>
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

                <div className="glass-card p-6 lg:col-span-1">
                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <Package className="w-5 h-5 text-red-500" /> Local Stock Alerts
                    </h3>
                    <div className="flex flex-col gap-4">
                        {(warehouseStats.low_stock_alerts || []).length > 0 ? (warehouseStats.low_stock_alerts || []).map((alert, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 bg-red-50/40 rounded-xl border border-red-100/20">
                                <div>
                                    <p className="font-bold text-sm text-gray-800">{alert.product_name}</p>
                                    <p className="text-[10px] text-red-500 font-bold uppercase">{alert.store_name}</p>
                                </div>
                                <div className="bg-red-500 text-white px-2 py-1 rounded-lg text-xs font-black">
                                    {alert.stock_quantity}
                                </div>
                            </div>
                        )) : (
                            <div className="flex flex-col items-center justify-center py-8 opacity-40">
                                <Check className="w-10 h-10 text-green-500 mb-2" />
                                <p className="text-sm text-gray-500 font-medium">All warehouses fully stocked</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AdminDashboard
