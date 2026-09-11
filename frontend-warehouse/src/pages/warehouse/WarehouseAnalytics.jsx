import { useState, useEffect, useCallback } from 'react'
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip,
    Legend
} from 'recharts'
import {
    Activity,
    CheckCircle2,
    Clock,
    AlertCircle,
    ArrowUpRight,
    Package,
    Loader2,
    PackageX,
    Boxes
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'

const WarehouseAnalytics = () => {
    const { warehouseLogout } = useStore()
    const [loading, setLoading] = useState(true)
    const [analytics, setAnalytics] = useState(null)
    const [error, setError] = useState('')
    const [refreshedAt, setRefreshedAt] = useState(null)

    const fetchAnalytics = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            const response = await apiFetch('/warehouse/analytics')
            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                return
            }
            if (!response.ok) throw new Error('Failed to fetch analytics')
            const data = await response.json()
            setAnalytics(data)
            setRefreshedAt(new Date())
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [warehouseLogout])

    useEffect(() => {
        fetchAnalytics()
    }, [fetchAnalytics])

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium tracking-tight">Syncing performance data engine...</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <AlertCircle className="w-10 h-10 text-rose-500" />
                <p className="text-slate-300 font-bold">Analytics load nahi ho paya: {error}</p>
                <button
                    onClick={fetchAnalytics}
                    className="px-5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-sm hover:bg-amber-500/20 transition-colors"
                >
                    Retry
                </button>
            </div>
        )
    }

    // Transform status breakdown for Recharts
    const statusData = analytics?.status_breakdown ? Object.entries(analytics.status_breakdown).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
        value: value
    })) : []

    const COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6']

    // --- Real metrics (backend-computed) ---
    const totalAssignments = analytics?.total_assignments || 0
    const acceptedAssignments = analytics?.accepted_assignments || 0
    const rejectedAssignments = analytics?.rejected_assignments || 0
    const pendingDispatch = analytics?.pending_dispatch || 0
    const acceptanceRate = totalAssignments > 0
        ? `${Math.round((acceptedAssignments / totalAssignments) * 100)}%`
        : '—'
    const stockHealth = analytics?.stock_health || {}
    const totalSkus = stockHealth.total_skus || 0
    const stockedOutSkus = stockHealth.stocked_out_skus || 0
    const lowStockSkus = stockHealth.low_stock_skus ?? analytics?.low_stock_skus ?? 0
    const activeSkus = stockHealth.active_skus || 0
    const outOfStockRate = totalSkus > 0
        ? `${Math.round((stockedOutSkus / totalSkus) * 100)}%`
        : '—'
    const stockHealthLabel = totalSkus === 0
        ? 'No Inventory'
        : stockedOutSkus === 0 && lowStockSkus === 0
            ? 'Optimal'
            : stockedOutSkus > 0
                ? 'Action Needed'
                : 'Watch'
    const capacity = analytics?.capacity || null
    const utilizationPct = capacity?.utilization_pct
    const noData = totalAssignments === 0 && totalSkus === 0

    const kpis = [
        {
            label: 'Acceptance Rate',
            value: acceptanceRate,
            sub: `${acceptedAssignments}/${totalAssignments} accepted`,
            icon: CheckCircle2,
            iconCls: 'text-amber-400'
        },
        {
            label: 'Pending Dispatch',
            value: String(pendingDispatch),
            sub: 'packed, awaiting handoff',
            icon: Clock,
            iconCls: 'text-blue-400'
        },
        {
            label: 'Stock Health',
            value: stockHealthLabel,
            sub: `${lowStockSkus} low • ${stockedOutSkus} out-of-stock`,
            icon: Package,
            iconCls: 'text-purple-400'
        },
        {
            label: 'Out-of-Stock',
            value: outOfStockRate,
            sub: `${stockedOutSkus} of ${totalSkus} SKUs`,
            icon: PackageX,
            iconCls: 'text-rose-400'
        }
    ]

    return (
        <div className="space-y-5 sm:space-y-8 animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-emerald-400/10 text-emerald-500">
                            <Activity size={20} />
                        </div>
                        <span className="text-sm font-black uppercase tracking-[0.2em] text-emerald-500">Operation Intelligence</span>
                    </div>
                    <h1 className="text-4xl font-black text-white tracking-tight">Logistics Analytics</h1>
                    <p className="text-slate-400 mt-2 font-medium">Deep dive into fulfillment metrics and inventory health.</p>
                </div>

                <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span>Last Refreshed: {refreshedAt ? refreshedAt.toLocaleTimeString() : '—'}</span>
                    <button onClick={fetchAnalytics} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all text-white active:rotate-180 duration-500">
                        <ArrowUpRight size={16} />
                    </button>
                </div>
            </div>

            {noData && (
                <div className="warehouse-panel p-6 border border-amber-400/20 bg-amber-400/5 flex items-start gap-3 text-amber-300">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <p className="text-xs font-bold leading-5">
                        Abhi tak koi order assignments ya inventory data nahi hai. Jaise hi orders assign aur inventory add hoga, yahan real metrics dikhenge.
                    </p>
                </div>
            )}

            {/* Performance KPIs — all values from the analytics API */}
            <div className="flex gap-3 overflow-x-auto pb-1">
                {kpis.map((stat, i) => (
                    <div key={i} className="flex-1 min-w-[150px] warehouse-panel p-4 border border-white/5 hover:border-white/10 transition-colors">
                        <div className="flex items-center gap-2">
                            <stat.icon size={16} className={`${stat.iconCls} shrink-0`} />
                        </div>
                        <div className="text-xl font-black text-white leading-none mt-2">{stat.value}</div>
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">{stat.label}</div>
                        <div className="text-[9px] font-bold text-slate-600 mt-0.5">{stat.sub}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
                {/* Fulfillment Status Chart */}
                <div className="lg:col-span-2 warehouse-panel p-4 sm:p-6 lg:p-8 border border-white/5 bg-white/[0.01]">
                    <div className="flex items-center justify-between mb-5 sm:mb-8">
                        <div>
                            <h3 className="text-lg font-black text-white uppercase tracking-tight">Fulfillment Snapshot</h3>
                            <p className="text-xs text-slate-500 mt-1 font-bold">Distribution of order statuses in current cycle.</p>
                        </div>
                        <span className="p-2.5 rounded-xl bg-white/5 text-slate-400">
                            <PieChart size={18} />
                        </span>
                    </div>

                    {statusData.length === 0 ? (
                        <div className="h-[250px] sm:h-[300px] lg:h-[350px] w-full flex flex-col items-center justify-center gap-2 border border-dashed border-white/5 rounded-3xl">
                            <Activity size={32} className="text-slate-800" />
                            <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">No order assignments yet</p>
                        </div>
                    ) : (
                        <div className="h-[250px] sm:h-[300px] lg:h-[350px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={statusData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={70}
                                        outerRadius={110}
                                        paddingAngle={8}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {statusData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#0f172a',
                                            border: '1px solid rgba(255,255,255,0.05)',
                                            borderRadius: '12px',
                                            fontSize: '12px',
                                            fontWeight: 'bold',
                                            color: '#fff'
                                        }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                    <Legend
                                        verticalAlign="bottom"
                                        height={36}
                                        formatter={(value) => <span className="text-xs font-black uppercase tracking-widest text-slate-400 mr-4">{value}</span>}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                {/* Stock Warnings — all real data */}
                <div className="warehouse-panel p-4 sm:p-6 lg:p-8 border border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
                    <div className="mb-5 sm:mb-8">
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Stock Warnings</h3>
                        <p className="text-xs text-slate-500 mt-1 font-bold">Priority alerts needing manual action.</p>
                    </div>

                    <div className="space-y-4">
                        {[
                            { title: 'Critical Stock Alert', message: `${lowStockSkus} SKUs below threshold`, type: 'critical' },
                            { title: 'Out-of-Stock', message: `${stockedOutSkus} SKUs need restock`, type: 'warning' },
                            { title: 'Dispatch Delay', message: `${pendingDispatch} packed orders awaiting handoff`, type: 'info' }
                        ].map((alert, i) => (
                            <div key={i} className={`p-4 rounded-2xl border ${
                                alert.type === 'critical' ? 'bg-rose-400/5 border-rose-400/20 text-rose-400' :
                                alert.type === 'warning' ? 'bg-amber-400/5 border-amber-400/20 text-amber-400' :
                                'bg-blue-400/5 border-blue-400/20 text-blue-400'
                            }`}>
                                <div className="flex items-center gap-3 mb-1">
                                    <AlertCircle size={16} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{alert.title}</span>
                                </div>
                                <p className="text-xs font-bold text-white pl-7 opacity-80">{alert.message}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-5 sm:mt-8 pt-8 border-t border-white/5 space-y-4 sm:space-y-6">
                        {capacity ? (
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Utilization</span>
                                    <span className="text-xs font-black text-white">{utilizationPct}%</span>
                                </div>
                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${utilizationPct >= 85 ? 'bg-rose-400' : utilizationPct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                        style={{ width: `${Math.min(100, Math.max(0, utilizationPct))}%` }}
                                    />
                                </div>
                                <p className="text-[9px] font-bold text-slate-600 mt-1.5 uppercase tracking-widest">
                                    {activeSkus} of {capacity.warehouse_capacity} SKU capacity
                                </p>
                            </div>
                        ) : (
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Utilization</span>
                                    <span className="text-xs font-black text-white">—</span>
                                </div>
                                <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                                    Set warehouse capacity in your profile to track utilization
                                </p>
                            </div>
                        )}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Inventory</span>
                                <span className="text-xs font-black text-white">{activeSkus}/{totalSkus} active</span>
                            </div>
                            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-400 rounded-full transition-all"
                                    style={{ width: totalSkus > 0 ? `${Math.min(100, Math.max(0, (activeSkus / totalSkus) * 100))}%` : '0%' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stock summary panel */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 border border-white/5">
                <div className="flex items-center justify-between mb-5 sm:mb-8">
                    <div>
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Inventory Summary</h3>
                        <p className="text-xs text-slate-500 mt-1 font-bold">Live stock counts from your warehouse inventory.</p>
                    </div>
                    <span className="p-2.5 rounded-xl bg-white/5 text-slate-400">
                        <Boxes size={18} />
                    </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { label: 'Total SKUs', value: totalSkus },
                        { label: 'In Stock', value: activeSkus },
                        { label: 'Low Stock', value: lowStockSkus },
                        { label: 'Out of Stock', value: stockedOutSkus }
                    ].map((item, i) => (
                        <div key={i} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                            <div className="text-2xl font-black text-white">{item.value}</div>
                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">{item.label}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default WarehouseAnalytics
