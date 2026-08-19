import { useState, useEffect, useCallback } from 'react'
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip,
    Legend,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    BarChart,
    Bar
} from 'recharts'
import {
    Activity,
    TrendingUp,
    CheckCircle2,
    Clock,
    AlertCircle,
    ArrowUpRight,
    ArrowDownRight,
    Package,
    Loader2
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

const WarehouseAnalytics = () => {
    const { warehouseToken, warehouseLogout } = useStore()
    const [loading, setLoading] = useState(true)
    const [analytics, setAnalytics] = useState(null)
    const [, setError] = useState('')

    const fetchAnalytics = useCallback(async () => {
        if (!warehouseToken) return
        setLoading(true)
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/analytics`, {
                headers: { Authorization: `Bearer ${warehouseToken}` }
            })
            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                return
            }
            if (!response.ok) throw new Error('Failed to fetch analytics')
            const data = await response.json()
            setAnalytics(data)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [warehouseToken, warehouseLogout])

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

    // Transform status breakdown for Recharts
    const statusData = analytics?.status_breakdown ? Object.entries(analytics.status_breakdown).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1).replace('_', ' '),
        value: value
    })) : []

    const COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6']

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
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
                    <span>Last Refreshed: {new Date().toLocaleTimeString()}</span>
                    <button onClick={fetchAnalytics} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all text-white active:rotate-180 duration-500">
                        <ArrowUpRight size={16} />
                    </button>
                </div>
            </div>

            {/* Performance KPIs */}
            <div className="flex gap-3 overflow-x-auto pb-1">
                {[
                    { label: 'Fulfillment Efficiency', value: '98.5%', change: '+2.4%', up: true, icon: TrendingUp, color: 'emerald' },
                    { label: 'Avg Dispatch Time', value: '14m', change: '-3m', up: true, icon: Clock, color: 'blue' },
                    { label: 'Acceptance Rate', value: '100%', change: '0%', up: true, icon: CheckCircle2, color: 'amber' },
                    { label: 'Stock Health', value: 'Optimal', change: 'Stable', up: true, icon: Package, color: 'purple' }
                ].map((stat, i) => (
                    <div key={i} className="flex-1 min-w-[150px] warehouse-panel p-4 border border-white/5 hover:border-white/10 transition-colors">
                        <div className="flex items-center gap-2">
                            <stat.icon size={16} className={`text-${stat.color}-400 shrink-0`} />
                            <div className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-tighter ${stat.up ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {stat.change}
                                {stat.up ? <ArrowUpRight size={8} /> : <ArrowDownRight size={8} />}
                            </div>
                        </div>
                        <div className="text-xl font-black text-white leading-none mt-2">{stat.value}</div>
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">{stat.label}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Fulfillment Status Chart */}
                <div className="lg:col-span-2 warehouse-panel p-4 sm:p-6 lg:p-8 border border-white/5 bg-white/[0.01]">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="text-lg font-black text-white uppercase tracking-tight">Fulfillment Snapshot</h3>
                            <p className="text-xs text-slate-500 mt-1 font-bold">Distribution of order statuses in current cycle.</p>
                        </div>
                        <span className="p-2.5 rounded-xl bg-white/5 text-slate-400">
                            <PieChart size={18} />
                        </span>
                    </div>

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
                </div>

                {/* Stock Distribution Heatmap Overview */}
                <div className="warehouse-panel p-4 sm:p-6 lg:p-8 border border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
                    <div className="mb-8">
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Stock Warnings</h3>
                        <p className="text-xs text-slate-500 mt-1 font-bold">Priority alerts needing manual action.</p>
                    </div>

                    <div className="space-y-4">
                        {[
                            { title: 'Critical Stock Alert', message: `${analytics?.low_stock_skus || 0} SKUs below threshold`, type: 'critical' },
                            { title: 'Capacity Warning', message: 'Warehouse at 84% utility', type: 'warning' },
                            { title: 'Dispatch Delay', message: '2 orders past expected handoff', type: 'info' }
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

                    <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Utilization</span>
                                <span className="text-xs font-black text-white">84%</span>
                            </div>
                            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-400 rounded-full" style={{ width: '84%' }} />
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Dispatch Speed</span>
                                <span className="text-xs font-black text-white">Optimal</span>
                            </div>
                            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: '92%' }} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Placeholder for Historical Trends */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 border border-white/5">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Trend Monitoring</h3>
                        <p className="text-xs text-slate-500 mt-1 font-bold">Performance analytics over the last 24 hours.</p>
                    </div>
                </div>
                
                <div className="h-[250px] w-full bg-white/[0.01] rounded-3xl border border-dashed border-white/5 flex flex-col items-center justify-center gap-2">
                    <Activity size={32} className="text-slate-800" />
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Historical Data Sync Pending</p>
                </div>
            </div>
        </div>
    )
}

export default WarehouseAnalytics
