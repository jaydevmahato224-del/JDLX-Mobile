import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, Users, LogOut, Clock, Activity, Search, ChevronRight, Globe, Monitor, Smartphone, Tablet } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { API_BASE_URL } from '../../config'

function Analytics() {
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

    const fetchToken = () => localStorage.getItem('adminToken') || localStorage.getItem('token');

    const fetchSummary = useCallback(() => {
        const token = fetchToken();
        fetch(`${API_BASE_URL}/admin/analytics/summary`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(res => { if (res.success) setSummary(res.data) })
            .catch(err => console.error(err));
    }, []);

    const fetchRealtime = useCallback(() => {
        const token = fetchToken();
        fetch(`${API_BASE_URL}/admin/analytics/realtime`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(res => { if (res.success) setRealtime(res.data) })
            .catch(err => console.error(err));
    }, []);

    const fetchTraffic = useCallback((period) => {
        const token = fetchToken();
        fetch(`${API_BASE_URL}/admin/analytics/traffic?period=${period}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(res => { if (res.success) setTrafficData(res.data) })
            .catch(err => console.error(err));
    }, []);

    const fetchOtherData = useCallback(() => {
        const token = fetchToken();
        const endpoints = ['top-pages', 'traffic-sources', 'devices', 'searches', 'funnel', 'user-journeys'];
        const setters = [setTopPages, setSources, setDevices, setSearches, setFunnel, setJourneys];

        endpoints.forEach((endpoint, idx) => {
            fetch(`${API_BASE_URL}/admin/analytics/${endpoint}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
                .then(res => res.json())
                .then(res => { if (res.success) setters[idx](res.data) })
                .catch(err => console.error(err));
        });
    }, []);

    useEffect(() => {
        fetchSummary();
        fetchRealtime();
        fetchTraffic(trafficPeriod);
        fetchOtherData();

        const rtInterval = setInterval(fetchRealtime, 30000);
        return () => clearInterval(rtInterval);
    }, [fetchSummary, fetchRealtime, fetchTraffic, fetchOtherData, trafficPeriod]);

    const chartData = trafficData.labels.map((label, i) => ({
        name: label,
        visits: trafficData.visits[i],
        unique: trafficData.unique_visits[i]
    }));

    return (
        <div className="py-6 flex flex-col gap-8 md:py-8 animate-in fade-in duration-700">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="ui-h2 font-black tracking-tighter">Site Analytics</h1>
                    <p className="ui-label opacity-60">Real-time behavior & traffic insights</p>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Live System Active</span>
                </div>
            </div>

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
        </div>
    );
}

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
