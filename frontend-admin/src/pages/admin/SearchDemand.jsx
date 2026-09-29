import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Search, TrendingUp, Trash2, RefreshCw, PackageX, Flame, ArrowLeft, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { apiFetch } from '../../utils/apiFetch'

/**
 * Search Demand — what customers are searching for.
 *
 * Two views, one dataset (search_demand rollup fed live by storefront
 * searches):
 *  - UNMET: terms that returned zero results → stock these products and the
 *    demand converts into orders. Each term links straight to the warehouse
 *    Add Product flow's catalog search so the gap can be filled immediately.
 *  - HOT: most-searched terms overall → merchandising signal (what to
 *    feature/put on the homepage), also surfaced as storefront trending chips.
 */

const TABS = [
    { id: 'unmet', label: 'Unmet Demand', icon: PackageX, hint: 'Searches that found NOTHING — stock these!' },
    { id: 'hot', label: 'Most Searched', icon: Flame, hint: 'What customers look for the most' },
    { id: 'all', label: 'All Recent', icon: Search, hint: 'Every tracked search term' },
]

function SearchDemand() {
    const [tab, setTab] = useState('unmet')
    const [items, setItems] = useState([])
    const [stats, setStats] = useState({})
    const [loading, setLoading] = useState(true)

    const fetchItems = useCallback(async () => {
        setLoading(true)
        try {
            const res = await apiFetch(`/admin/search-demand?filter=${tab}&limit=150`)
            const data = await res.json().catch(() => ({}))
            if (res.ok) {
                setItems(data.data?.items || [])
                setStats(data.data?.stats || {})
            } else {
                toast.error(data.message || 'Failed to load search demand')
            }
        } catch {
            toast.error('Network error — please retry')
        } finally {
            setLoading(false)
        }
    }, [tab])

    useEffect(() => { fetchItems() }, [fetchItems])

    const removeTerm = async (id, term) => {
        if (!window.confirm(`Dismiss "${term}" from the demand list? (Yeh process ho chuka hoga toh hi)`)) return
        try {
            const res = await apiFetch(`/admin/search-demand/${id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Dismissed')
                fetchItems()
            } else {
                const data = await res.json().catch(() => ({}))
                toast.error(data.message || 'Failed to dismiss')
            }
        } catch {
            toast.error('Network error — please retry')
        }
    }

    const activeTab = TABS.find(t => t.id === tab)
    const unmetShare = stats.total_searches > 0 ? Math.round((stats.total_unmet / stats.total_searches) * 100) : 0

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Link to="/admin/dashboard" className="p-2 rounded-full hover:bg-slate-200 transition-colors"><ArrowLeft size={18} /></Link>
                        <div>
                            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
                                <TrendingUp size={20} className="text-emerald-600" /> Search Demand
                            </h1>
                            <p className="text-xs text-gray-500">Customers kya search kar rahe hain — especially jo MIL nahi raha</p>
                        </div>
                    </div>
                    <button onClick={fetchItems} className="p-2 rounded-full hover:bg-slate-200 transition-colors" aria-label="Refresh">
                        <RefreshCw size={16} className={loading ? 'animate-spin text-emerald-600' : 'text-slate-500'} />
                    </button>
                </div>

                {/* Platform-wide demand stats */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Searches</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">{stats.total_searches ?? 0}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Unmet (0 results)</p>
                        <p className="text-2xl font-black text-rose-600 mt-1">{stats.total_unmet ?? 0}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lost Demand</p>
                        <p className="text-2xl font-black text-amber-600 mt-1">{unmetShare}%</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider border transition-colors flex items-center gap-1.5 ${tab === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                            <t.icon size={13} /> {t.label}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-gray-400 -mt-2">{activeTab?.hint}</p>

                {loading ? (
                    <div className="flex items-center justify-center py-24"><RefreshCw size={28} className="animate-spin text-emerald-500" /></div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><TrendingUp size={28} /></div>
                        <h3 className="text-lg font-black text-slate-700">Nothing here yet</h3>
                        <p className="text-xs text-gray-400 max-w-xs">
                            {tab === 'unmet'
                                ? 'Abhi tak koi zero-result search nahi hui. Jab customer kuch aisa search karega jo store pe nahi hai, wo yahan dikhega.'
                                : 'Jaise-jaise customers search karenge, terms yahan rank hone lagenge.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-2">
                        {items.map((it, idx) => {
                            const unmetPct = it.search_count > 0 ? Math.round((it.unmet_count / it.search_count) * 100) : 0
                            return (
                                <div key={it.term} className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-4 hover:shadow-sm transition-shadow">
                                    <span className={`w-8 text-center text-sm font-black shrink-0 ${tab === 'unmet' ? 'text-rose-500' : 'text-slate-300'}`}>
                                        {idx + 1}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-black text-slate-900 truncate">{it.term}</p>
                                        <p className="text-[11px] font-bold text-gray-400 mt-0.5">
                                            {it.search_count} searches
                                            {it.unmet_count > 0 && <span className="text-rose-500"> • {it.unmet_count} with NO results ({unmetPct}%)</span>}
                                            {it.last_searched_at && <span> • last: {String(it.last_searched_at).slice(0, 16).replace('T', ' ')}</span>}
                                        </p>
                                    </div>
                                    {/* Straight to the warehouse Add Product catalog search —
                                        fill the gap in one click. */}
                                    <a
                                        href="https://jdlx-mobile-warehouse.vercel.app/warehouse/inventory"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="shrink-0 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 hover:bg-emerald-100 transition-colors"
                                    >
                                        <ExternalLink size={11} /> Stock It
                                    </a>
                                    <button
                                        onClick={() => removeTerm(it.id, it.term)}
                                        className="shrink-0 p-2 rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                        aria-label={`Dismiss ${it.term}`}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

export default SearchDemand
