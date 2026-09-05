import { useState, useEffect } from 'react'
import { ArrowLeft, RefreshCw, LineChart, Brain, AlertTriangle, TrendingUp, PackageSearch } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'

function AdminIntelligence() {
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [storeFilter, setStoreFilter] = useState('')
    const [stores, setStores] = useState([])
    const navigate = useNavigate()

    const fetchData = async () => {
        setLoading(true)
        try {
            // 1. Fetch available stores for the dropdown filter
            if (stores.length === 0) {
                const storesRes = await apiFetch('/admin/stores');
                if (storesRes.ok) {
                    const storesData = await storesRes.json();
                    setStores(storesData);
                }
            }

            // 2. Fetch Machine Learning Forecast
            let url = `/admin/inventory/demand-forecast`
            if (storeFilter) url += `?store_id=${storeFilter}`

            const res = await apiFetch(url)
            if (res.ok) {
                const data = await res.json()
                setStats(data)
            }
        } catch (err) {
            console.error('Failed to fetch intelligence', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
    }, [storeFilter])

    const getRiskColor = (risk) => {
        if (risk === 'Critical') return 'bg-red-100 text-red-700 border-red-200'
        if (risk === 'Warning') return 'bg-amber-100 text-amber-700 border-amber-200'
        return 'bg-green-100 text-green-700 border-green-200'
    }

    return (
        <div className="py-6 flex flex-col gap-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/admin')} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-800" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <Brain className="w-6 h-6 text-purple-600" />
                            AI Demand Prediction
                        </h1>
                        <p className="text-sm text-gray-500 font-medium tracking-wide">Machine Learning Forecaster & Velocity Engine</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <select
                        value={storeFilter}
                        onChange={(e) => setStoreFilter(e.target.value)}
                        className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-bold bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                        <option value="">Global Network Forecast</option>
                        {stores.map(s => (
                            <option key={s.id} value={s.id}>{s.name} (ID: {s.id})</option>
                        ))}
                    </select>

                    <button
                        onClick={fetchData}
                        className="p-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
                        disabled={loading}
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {loading && !stats ? (
                <div className="h-64 flex items-center justify-center text-purple-500 animate-pulse font-bold text-lg gap-3">
                    <Brain className="w-6 h-6 animate-bounce" /> Synchronizing Neural Network...
                </div>
            ) : stats ? (
                <>
                    {/* Header Top Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-3xl p-6 text-white shadow-xl flex flex-col gap-2 relative overflow-hidden">
                            <Brain className="absolute -right-4 -bottom-4 w-32 h-32 text-white/10" />
                            <h3 className="text-purple-100 text-sm font-bold uppercase tracking-wider relative z-10">AI Items Monitored</h3>
                            <p className="text-4xl font-black relative z-10">{stats.total_items_analyzed}</p>
                            <span className="text-xs text-purple-200 font-medium relative z-10">Products tracking active 30-day telemetry</span>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex flex-col gap-2">
                            <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-500" /> Peak Velocity</h3>
                            <p className="text-xl font-bold text-gray-800 line-clamp-1">{stats.fast_sellers?.[0]?.product_name || 'N/A'}</p>
                            <span className="text-xs text-gray-400 font-medium">Top selling item in the last 168 hours</span>
                        </div>
                        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex flex-col gap-2">
                            <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" /> Logistics Risk</h3>
                            <p className="text-3xl font-black text-gray-800">{stats.low_stock_risk?.length || 0}</p>
                            <span className="text-xs text-gray-400 font-medium">Products mathematically guaranteed to stock-out</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Fastest Moving Items */}
                        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-6">
                                <TrendingUp className="w-5 h-5 text-green-500" /> Fast Moving Products (7d)
                            </h2>
                            <div className="flex flex-col gap-4">
                                {stats.fast_sellers.length === 0 ? (
                                    <div className="text-center p-8 text-gray-400 italic font-medium">Insufficient sales telemetry data for 7-day analysis.</div>
                                ) : (
                                    stats.fast_sellers.map((item, index) => (
                                        <div key={item.product_id} className="flex items-center justify-between p-4 bg-gray-50/80 rounded-2xl hover:bg-gray-100 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-sm">
                                                    #{index + 1}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-800">{item.product_name}</p>
                                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{item.category}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-black text-gray-800">{item.sales_7d}</p>
                                                <p className="text-[10px] text-green-600 font-bold">Units / Week</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Artificial Intelligence Restock Directives */}
                        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col h-full">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-2">
                                <LineChart className="w-5 h-5 text-indigo-500" /> Deep Analytics Forecast
                            </h2>
                            <p className="text-xs text-gray-500 font-medium mb-6">Comparing 7-day sales velocity projections against current physical inventory counts to generate mathematically optimal procurement strategies.</p>

                            <div className="flex-1 overflow-auto max-h-[500px] pr-2 custom-scrollbar">
                                <div className="flex flex-col gap-3">
                                    {stats.predictions.length === 0 ? (
                                        <div className="text-center p-8 text-gray-400 italic font-medium">No sales data found to perform deep analysis.</div>
                                    ) : (
                                        stats.predictions.map(item => (
                                            <div key={item.product_id} className={`p-4 rounded-2xl border ${getRiskColor(item.risk_level)} bg-opacity-30 flex flex-col gap-3`}>
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <p className="font-bold text-gray-900">{item.product_name}</p>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${item.risk_level === 'Critical' ? 'bg-red-200 text-red-800' : item.risk_level === 'Warning' ? 'bg-amber-200 text-amber-800' : 'bg-green-200 text-green-800'}`}>
                                                                {item.risk_level} VECTOR
                                                            </span>
                                                            <span className="text-[10px] text-gray-600 font-bold">AVG: {item.daily_avg_velocity} units/day</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="bg-white/60 rounded-xl p-3 flex items-center justify-between text-center">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[10px] text-gray-500 font-bold uppercase">Stored</span>
                                                        <span className="text-sm font-black text-gray-800">{item.current_stock}</span>
                                                    </div>
                                                    <span className="text-gray-300">vs</span>
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[10px] text-gray-500 font-bold uppercase">7D Need</span>
                                                        <span className="text-sm font-black text-gray-800">{item.predicted_7d_demand}</span>
                                                    </div>
                                                    <span className="text-gray-300">=</span>
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider">Restock</span>
                                                        <span className="text-xl font-black text-indigo-700">{item.recommended_restock > 0 ? `+${item.recommended_restock}` : '0'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-gray-100">
                                <button className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-bold shadow-md hover:bg-gray-800 transition-colors flex items-center justify-center gap-2">
                                    <PackageSearch className="w-4 h-4" /> Forward Directives to Replenishment
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    )
}

export default AdminIntelligence
