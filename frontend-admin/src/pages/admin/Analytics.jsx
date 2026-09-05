import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, Users, LogOut, Clock, Activity, Search, ChevronRight, Globe, Monitor, Smartphone, Tablet, AlertTriangle, Ban, Calendar, IndianRupee, ArrowDownRight, RefreshCw, X, ShieldAlert } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, AreaChart, Area, Cell, Legend } from 'recharts'
import { API_BASE_URL } from '../../config'
import toast from 'react-hot-toast'
import { apiFetch } from '../../utils/apiFetch'

function Analytics() {
    const [activeTab, setActiveTab] = useState('traffic'); // 'traffic' | 'cancellations'
    
    // Traffic Analytics States
    const [summary, setSummary] = useState({
        total_visits_today: 0,
        total_visits_week: 0,
        unique_visitors_today: 0,
        bounce_rate: 0,
        avg_session_duration: 0,
        top_product_search: null
    });

    const [realtime, setRealtime] = useState({
        active_users: 0,
        active_pages: []
    });

    const [trafficData, setTrafficData] = useState({
        labels: [],
        visits: [],
        unique_visits: []
    });
    const [trafficPeriod, setTrafficPeriod] = useState('week');

    const [topPages, setTopPages] = useState([]);
    const [sources, setSources] = useState([]);
    const [devices, setDevices] = useState({ summary: { mobile: 0, desktop: 0, tablet: 0 }, details: [] });
    const [searches, setSearches] = useState([]);
    const [funnel, setFunnel] = useState({ steps: [] });
    const [journeys, setJourneys] = useState([]);

    // Cancellations & Rejections States
    const [cancelledData, setCancelledData] = useState(null);
    const [cancelledLoading, setCancelledLoading] = useState(true);
    const [cancelledSearch, setCancelledSearch] = useState('');
    const [cancelledPeriod, setCancelledPeriod] = useState('monthly'); // 'monthly' | 'weekly' | 'yearly'

    const fetchSummary = useCallback(() => {
        apiFetch('/admin/analytics/summary')
            .then(res => res.json())
            .then(res => { if (res.success) setSummary(res.data) })
            .catch(err => console.error(err));
    }, []);

    const fetchRealtime = useCallback(() => {
        apiFetch('/admin/analytics/realtime')
            .then(res => res.json())
            .then(res => { if (res.success) setRealtime(res.data) })
            .catch(err => console.error(err));
    }, []);

    const fetchTraffic = useCallback((period) => {
        apiFetch(`/admin/analytics/traffic?period=${period}`)
            .then(res => res.json())
            .then(res => { if (res.success) setTrafficData(res.data) })
            .catch(err => console.error(err));
    }, []);

    const fetchOtherData = useCallback(() => {
        const endpoints = ['top-pages', 'traffic-sources', 'devices', 'searches', 'funnel', 'user-journeys'];
        const setters = [setTopPages, setSources, setDevices, setSearches, setFunnel, setJourneys];

        endpoints.forEach((endpoint, idx) => {
            apiFetch(`/admin/analytics/${endpoint}`)
                .then(res => res.json())
                .then(res => { if (res.success) setters[idx](res.data) })
                .catch(err => console.error(err));
        });
    }, []);

    const fetchCancelledAnalytics = useCallback(() => {
        setCancelledLoading(true);
        apiFetch('/admin/cancelled-analytics')
            .then(res => res.json())
            .then(res => {
                if (res.error) {
                    toast.error(res.error);
                } else {
                    setCancelledData(res);
                }
            })
            .catch(err => {
                console.error(err);
                toast.error("Failed to load cancellation analytics");
            })
            .finally(() => setCancelledLoading(false));
    }, []);

    useEffect(() => {
        if (activeTab === 'traffic') {
            // Fetches are fire-and-forget; Promise.all keeps them out of the
            // synchronous effect body (the interval below still polls realtime).
            Promise.all([
                fetchSummary(),
                fetchRealtime(),
                fetchTraffic(trafficPeriod),
                fetchOtherData(),
            ]);

            const rtInterval = setInterval(fetchRealtime, 30000);
            return () => clearInterval(rtInterval);
        } else {
            // Wrapped so the fetch isn't invoked synchronously from the effect body
            const load = () => fetchCancelledAnalytics();
            load();
        }
    }, [activeTab, fetchSummary, fetchRealtime, fetchTraffic, fetchOtherData, trafficPeriod, fetchCancelledAnalytics]);

    const chartData = trafficData.labels.map((label, i) => ({
        name: label,
        visits: trafficData.visits[i],
        unique: trafficData.unique_visits[i]
    }));

    return (
        <div className="py-6 flex flex-col gap-8 md:py-8 animate-in fade-in duration-700">
            {/* Tab Header Switcher */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                    <h1 className="ui-h2 font-black tracking-tighter text-3xl text-slate-900 flex items-center gap-2">
                        <Activity className="text-indigo-600 w-8 h-8" />
                        Analytics Intelligence
                    </h1>
                    <p className="ui-label opacity-60 mt-1">Real-time visitor logs & order cancellation insights</p>
                </div>
                
                <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner w-fit">
                    <button
                        onClick={() => setActiveTab('traffic')}
                        className={`px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                            activeTab === 'traffic' 
                                ? 'bg-white text-indigo-700 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <Activity className="w-4 h-4" /> Traffic & Behavior
                    </button>
                    <button
                        onClick={() => setActiveTab('cancellations')}
                        className={`px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                            activeTab === 'cancellations' 
                                ? 'bg-white text-rose-600 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <Ban className="w-4 h-4" /> Cancellations & Rejections
                    </button>
                </div>
            </div>

            {activeTab === 'traffic' ? (
                <>
                    {/* SECTION 1: Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                        <StatCard title="Today's visits" value={summary.total_visits_today} icon={TrendingUp} color="blue" />
                        <StatCard title="Unique visitors" value={summary.unique_visitors_today} icon={Users} color="purple" />
                        <StatCard title="Bounce rate" value={`${summary.bounce_rate}%`} icon={LogOut} color="orange" />
                        <StatCard title="Avg session" value={`${Math.round(summary.avg_session_duration / 60)}m`} icon={Clock} color="emerald" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* SECTION 2: Realtime Widget */}
                        <div className="glass-card p-6 flex flex-col gap-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Realtime</h3>
                                <Activity className="text-emerald-500 animate-pulse" size={18} />
                            </div>
                            <div className="text-center py-4">
                                <div className="text-6xl font-black tracking-tighter text-gray-900">{realtime.active_users}</div>
                                <p className="ui-label mt-2 opacity-60">active users right now</p>
                            </div>
                            <div className="space-y-3 mt-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 pb-2">Active Pages</p>
                                {realtime.active_pages.map((page, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                        <span className="font-bold truncate max-w-[200px]">{page.page_path}</span>
                                        <span className="bg-slate-100 px-2 py-0.5 rounded-lg font-black text-[10px]">{page.count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* SECTION 3: Traffic Graph */}
                        <div className="glass-card p-6 lg:col-span-2 flex flex-col gap-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Traffic Trend</h3>
                                <div className="flex bg-slate-100 p-1 rounded-xl">
                                    {['today', 'week', 'month'].map(p => (
                                        <button
                                            key={p}
                                            onClick={() => setTrafficPeriod(p)}
                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${trafficPeriod === p ? 'bg-white shadow-sm text-primary' : 'text-gray-400 hover:text-gray-600'}`}
                                        >
                                            {p === 'today' ? 'Today' : p === 'week' ? 'Week' : 'Month'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="h-[250px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} dy={10} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 800 }}
                                        />
                                        <Line type="monotone" dataKey="visits" name="Total visits" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                                        <Line type="monotone" dataKey="unique" name="Unique visits" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* SECTION 4: 3-column Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Column 1: Top Pages */}
                        <div className="glass-card p-6">
                            <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-6">Top Pages</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">
                                            <th className="pb-3">Page</th>
                                            <th className="pb-3 text-right">Views</th>
                                            <th className="pb-3 text-right">Avg Time</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {topPages.map((page, i) => (
                                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="py-3 font-bold truncate max-w-[120px]">{page.page_path}</td>
                                                <td className="py-3 text-right font-black">{page.views}</td>
                                                <td className="py-3 text-right text-gray-400 font-bold">{Math.round(page.avg_duration)}s</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Column 2: Traffic Sources */}
                        <div className="glass-card p-6 flex flex-col gap-6">
                            <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Traffic Sources</h3>
                            <div className="space-y-5">
                                {sources.map((source, i) => {
                                    const total = sources.reduce((acc, s) => acc + s.visits, 0);
                                    const pct = Math.round((source.visits / total) * 100) || 0;
                                    return (
                                        <div key={i} className="space-y-2">
                                            <div className="flex justify-between text-xs font-black uppercase tracking-tight">
                                                <span>{source.source}</span>
                                                <span className="text-gray-400">{source.visits} ({pct}%)</span>
                                            </div>
                                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Column 3: Devices */}
                        <div className="glass-card p-6 flex flex-col gap-8">
                            <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Devices</h3>
                            <div className="flex flex-col gap-8 flex-1 justify-center">
                                <DeviceStat label="Mobile" pct={calculateDevicePct(devices.summary.mobile, devices.summary)} icon={Smartphone} color="emerald" />
                                <DeviceStat label="Desktop" pct={calculateDevicePct(devices.summary.desktop, devices.summary)} icon={Monitor} color="blue" />
                                <DeviceStat label="Tablet" pct={calculateDevicePct(devices.summary.tablet, devices.summary)} icon={Tablet} color="orange" />
                            </div>
                        </div>
                    </div>

                    {/* SECTION 5: 2-column Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Column 1: Top Searches */}
                        <div className="glass-card p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Top Searches</h3>
                                <Search className="text-gray-300" size={18} />
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {searches.map((s, i) => (
                                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-xl hover:bg-white transition-all cursor-default">
                                        <span className="text-xs font-bold text-gray-700">{s.query}</span>
                                        <span className="text-[9px] font-black text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">{s.count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Column 2: Conversion Funnel */}
                        <div className="glass-card p-6 flex flex-col gap-6">
                            <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Conversion Funnel</h3>
                            <div className="space-y-4 py-2">
                                {funnel.steps.map((step, i) => (
                                    <div key={i} className="flex flex-col gap-1.5">
                                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-gray-500 px-1">
                                            <span>{step.name}</span>
                                            <span>{step.count} ({step.percentage}%)</span>
                                        </div>
                                        <div className="w-full h-10 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden flex items-center px-4 relative">
                                            <div 
                                                className="absolute left-0 top-0 bottom-0 bg-primary/10 border-r-2 border-primary/20 transition-all duration-1000" 
                                                style={{ width: `${step.percentage}%` }} 
                                            />
                                            <div className="relative z-10 flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                                <span className="text-xs font-black text-slate-900">{step.name}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 6: User Journeys */}
                    <div className="glass-card p-6">
                        <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-6">User Journeys</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">
                                        <th className="pb-3">From Page</th>
                                        <th className="pb-3 w-8 text-center opacity-30"><ChevronRight size={14} /></th>
                                        <th className="pb-3">To Page</th>
                                        <th className="pb-3 text-right">Transitions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {journeys.map((j, i) => (
                                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="py-4 font-bold text-gray-600">{j.from_page}</td>
                                            <td className="py-4 text-center opacity-20"><ChevronRight size={14} /></td>
                                            <td className="py-4 font-black text-gray-900">{j.to_page}</td>
                                            <td className="py-4 text-right">
                                                <span className="bg-primary/10 text-primary px-3 py-1 rounded-full font-black text-[10px] uppercase">{j.count}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            ) : (
                /* NEW GORGEOUS CANCELLATIONS & REJECTIONS METRICS VIEW */
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-500">
                    {cancelledLoading ? (
                        <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4">
                            <RefreshCw className="w-10 h-10 text-rose-500 animate-spin" />
                            <p className="text-sm text-slate-500 font-bold animate-pulse uppercase tracking-wider">Analyzing Realized Cancellation Data...</p>
                        </div>
                    ) : cancelledData ? (
                        <>
                            {/* Summary Metrics Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="glass-card p-6 flex flex-col gap-2 border-l-4 border-rose-500 transition-all hover:scale-[1.02] hover:shadow-xl bg-gradient-to-br from-rose-50/30 to-transparent">
                                    <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center border border-rose-200 shadow-sm">
                                        <IndianRupee className="w-6 h-6" />
                                    </div>
                                    <p className="text-gray-500 text-[11px] font-black uppercase tracking-wider mt-3">Total Realized Lost Revenue</p>
                                    <h2 className="text-3xl font-black text-rose-700 tracking-tighter">
                                        ₹{cancelledData.summary?.lost_revenue?.toLocaleString('en-IN') || '0.00'}
                                    </h2>
                                    <p className="text-[10px] text-rose-600/80 font-bold mt-1 uppercase tracking-tight flex items-center gap-1">
                                        <ArrowDownRight className="w-3.5 h-3.5" /> Excludes Drafts & Abandoned checkouts
                                    </p>
                                </div>

                                <div className="glass-card p-6 flex flex-col gap-2 border-l-4 border-amber-500 transition-all hover:scale-[1.02] hover:shadow-xl bg-gradient-to-br from-amber-50/30 to-transparent">
                                    <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center border border-amber-200 shadow-sm">
                                        <AlertTriangle className="w-6 h-6" />
                                    </div>
                                    <p className="text-gray-500 text-[11px] font-black uppercase tracking-wider mt-3">Verified Orders Cancelled</p>
                                    <h2 className="text-3xl font-black text-amber-700 tracking-tighter">
                                        {cancelledData.summary?.cancelled_count || 0}
                                    </h2>
                                    <p className="text-[10px] text-amber-600/80 font-bold mt-1 uppercase tracking-tight">
                                        Cancelled post-confirmation
                                    </p>
                                </div>

                                <div className="glass-card p-6 flex flex-col gap-2 border-l-4 border-slate-600 transition-all hover:scale-[1.02] hover:shadow-xl bg-gradient-to-br from-slate-50/30 to-transparent">
                                    <div className="w-12 h-12 bg-slate-100 text-slate-600 rounded-2xl flex items-center justify-center border border-slate-200 shadow-sm">
                                        <Ban className="w-6 h-6" />
                                    </div>
                                    <p className="text-gray-500 text-[11px] font-black uppercase tracking-wider mt-3">Verified Orders Rejected</p>
                                    <h2 className="text-3xl font-black text-slate-700 tracking-tighter">
                                        {cancelledData.summary?.rejected_count || 0}
                                    </h2>
                                    <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase tracking-tight">
                                        Rejected during processing
                                    </p>
                                </div>
                            </div>

                            {/* Charts & Reasons */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* Trend Chart widget */}
                                <div className="glass-card p-6 lg:col-span-2 flex flex-col gap-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Cancellation Timeline Trend</h3>
                                            <p className="text-[10px] text-slate-400 font-medium">Verified cancelled/rejected transactions count</p>
                                        </div>
                                        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                                            {['weekly', 'monthly', 'yearly'].map(p => (
                                                <button
                                                    key={p}
                                                    onClick={() => setCancelledPeriod(p)}
                                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${cancelledPeriod === p ? 'bg-white shadow-sm text-rose-600' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    {p}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="h-[280px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={cancelledData.trends?.[cancelledPeriod] || []}>
                                                <defs>
                                                    <linearGradient id="roseGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/>
                                                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.01}/>
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} dy={10} />
                                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 800 }}
                                                    formatter={(value, name) => [value, name === 'count' ? 'Orders Count' : 'Lost Value (₹)']}
                                                />
                                                <Area type="monotone" dataKey="count" name="count" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#roseGradient)" dot={{ r: 4, fill: '#f43f5e', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Cancellation Reasons Distribution */}
                                <div className="glass-card p-6 flex flex-col gap-6">
                                    <div>
                                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Primary Cancellation Reasons</h3>
                                        <p className="text-[10px] text-slate-400 font-medium">Distribution breakdown by reason</p>
                                    </div>
                                    <div className="space-y-5 overflow-y-auto max-h-[280px] pr-2">
                                        {cancelledData.reasons?.length > 0 ? (
                                            cancelledData.reasons.map((r, i) => {
                                                const total = cancelledData.reasons.reduce((acc, curr) => acc + curr.count, 0);
                                                const pct = Math.round((r.count / total) * 100) || 0;
                                                return (
                                                    <div key={i} className="space-y-2">
                                                        <div className="flex justify-between text-xs font-black uppercase tracking-tight">
                                                            <span className="truncate max-w-[170px] text-slate-700">{r.reason}</span>
                                                            <span className="text-slate-400 font-mono">{r.count} ({pct}%)</span>
                                                        </div>
                                                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                                            <div 
                                                                className={`h-full rounded-full transition-all duration-1000 ${
                                                                    i === 0 ? 'bg-rose-500' : i === 1 ? 'bg-amber-500' : 'bg-slate-500'
                                                                }`} 
                                                                style={{ width: `${pct}%` }} 
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <p className="text-sm text-slate-400 py-6 text-center">No cancellation reason logged yet.</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Detailed Cancellations Search & Log Table */}
                            <div className="glass-card p-6 flex flex-col gap-6">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-base font-black uppercase tracking-widest text-slate-900">User Cancellations Audit Log</h3>
                                        <p className="text-xs text-slate-400 font-medium">Real-time trace of customer and administrative cancellations</p>
                                    </div>
                                    <div className="relative w-full sm:w-80">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <input
                                            type="text"
                                            placeholder="Search by ID, Name, Order..."
                                            value={cancelledSearch}
                                            onChange={(e) => setCancelledSearch(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none text-xs bg-slate-50/50 focus:bg-white transition-all font-medium text-slate-700"
                                        />
                                    </div>
                                </div>

                                <div className="overflow-x-auto border border-slate-100 rounded-2xl shadow-sm">
                                    <table className="w-full text-left text-sm border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50/80 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                <th className="p-4">Customer Details</th>
                                                <th className="p-4">Order Number</th>
                                                <th className="p-4">Cancelled Date</th>
                                                <th className="p-4">Status</th>
                                                <th className="p-4">Realized Loss</th>
                                                <th className="p-4">cancellation Reason</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50 text-slate-700 font-medium">
                                            {cancelledData.orders?.filter(o => {
                                                const searchVal = cancelledSearch.toLowerCase().trim();
                                                if (!searchVal) return true;
                                                return (
                                                    o.order_number?.toLowerCase().includes(searchVal) ||
                                                    o.customer_name?.toLowerCase().includes(searchVal) ||
                                                    o.customer_email?.toLowerCase().includes(searchVal) ||
                                                    String(o.user_id).includes(searchVal) ||
                                                    o.cancellation_reason?.toLowerCase().includes(searchVal)
                                                );
                                            }).length > 0 ? (
                                                cancelledData.orders.filter(o => {
                                                    const searchVal = cancelledSearch.toLowerCase().trim();
                                                    if (!searchVal) return true;
                                                    return (
                                                        o.order_number?.toLowerCase().includes(searchVal) ||
                                                        o.customer_name?.toLowerCase().includes(searchVal) ||
                                                        o.customer_email?.toLowerCase().includes(searchVal) ||
                                                        String(o.user_id).includes(searchVal) ||
                                                        o.cancellation_reason?.toLowerCase().includes(searchVal)
                                                    );
                                                }).map((order) => (
                                                    <tr key={order.id} className="hover:bg-slate-50/30 transition-colors">
                                                        <td className="p-4">
                                                            <div className="flex flex-col">
                                                                <span className="font-bold text-slate-900">{order.customer_name}</span>
                                                                <span className="text-slate-400 text-[10px] font-bold">
                                                                    ID: #{order.user_id} • {order.customer_email}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="p-4 font-mono font-bold text-indigo-600">
                                                            {order.order_number}
                                                        </td>
                                                        <td className="p-4 text-xs font-bold text-slate-500">
                                                            {new Date(order.cancelled_at).toLocaleDateString()}
                                                            <span className="text-[10px] text-slate-400 block font-normal mt-0.5">
                                                                {new Date(order.cancelled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </td>
                                                        <td className="p-4">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                                                                order.order_status === 'REJECTED' 
                                                                    ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                                            }`}>
                                                                {order.order_status}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 font-bold text-slate-950">
                                                            ₹{order.total_amount?.toFixed(2)}
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="px-3 py-1 bg-slate-50 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-600 w-fit max-w-[250px] truncate" title={order.cancellation_reason}>
                                                                {order.cancellation_reason}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan="6" className="p-10 text-center text-slate-400 font-bold uppercase tracking-wider text-xs">
                                                        No cancellation logs found matching search.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="p-10 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-100">
                            <ShieldAlert className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                            <p className="text-sm font-bold">Failed to recover cancellations log from database.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );;
}

// eslint-disable-next-line no-unused-vars -- Icon is used below as <Icon /> (JSX element)
function StatCard({ title, value, icon: Icon, color }) {
    const colors = {
        blue: 'bg-blue-50 text-blue-500 border-blue-100',
        purple: 'bg-purple-50 text-purple-500 border-purple-100',
        orange: 'bg-orange-50 text-orange-500 border-orange-100',
        emerald: 'bg-emerald-50 text-emerald-500 border-emerald-100'
    };
    return (
        <div className={`glass-card p-6 flex flex-col gap-2 transition-all hover:scale-[1.02] border-l-4 ${color === 'blue' ? 'border-blue-500' : color === 'purple' ? 'border-purple-500' : color === 'orange' ? 'border-orange-500' : 'border-emerald-500'}`}>
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${colors[color]}`}>
                <Icon size={20} />
            </div>
            <p className="ui-label mt-2 opacity-60">{title}</p>
            <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{value}</h2>
        </div>
    );
}

// eslint-disable-next-line no-unused-vars -- Icon is used below as <Icon /> (JSX element)
function DeviceStat({ label, pct, icon: Icon, color }) {
    const colors = {
        emerald: 'bg-emerald-500',
        blue: 'bg-blue-500',
        orange: 'bg-orange-500'
    };
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon size={16} className="text-gray-400" />
                    <span className="text-xs font-black uppercase tracking-widest text-gray-600">{label}</span>
                </div>
                <span className="text-xs font-black">{pct}%</span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${colors[color]} rounded-full transition-all duration-1000`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function calculateDevicePct(count, summary) {
    const total = (summary.mobile || 0) + (summary.desktop || 0) + (summary.tablet || 0);
    if (total === 0) return 0;
    return Math.round((count / total) * 100);
}

export default Analytics;
