import {
    Activity,
    TrendingUp,
    CheckCircle2,
    Clock,
    AlertCircle,
    ArrowUpRight,
    ArrowDownRight,
    Package,
    Loader2,
    ArrowUpRight,
    ArrowDownRight,
    Package,
    Zap,
    Globe,
    Monitor,
    Smartphone,
    Tablet,
    AlertTriangle,
    Ban,
    Calendar,
    IndianRupee,
    ArrowDownRight,
    RefreshCw,
    X,
    ShieldAlert,
    Search,
    Filter,
    ChevronRight,
    ChevronLeft,
    X,
} from 'lucide-react'
import { API_BASE_URL } from '../../../config'
import { useStore } from '../../../store/useStore'
import { apiFetch } from '../../../utils/apiFetch'
import { toast } from 'react-hot-toast'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, AreaChart, Area, Cell, Legend } from 'recharts'

export default function ProductDiscovery({
    newProductData,
    setNewProductData,
}) {
    return (
        <>
            {/* SECTION 6: DISCOVERY */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-sky-400/10 text-sky-400">
                        <Zap size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Discovery & SEO</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Search optimization and storefront visibility</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Meta Title</label>
                        <input
                            type="text"
                            placeholder="e.g. Ultra Fast Charger 65W - Premium Quality"
                            value={newProductData.discovery?.meta_title || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                discovery: { ...prev.discovery, meta_title: e.target.value }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 focus:ring-4 focus:ring-sky-400/5 transition-all outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Meta Description</label>
                        <textarea
                            rows="3"
                            placeholder="Brief description for search results (max 160 chars)..."
                            value={newProductData.discovery?.meta_description || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                discovery: { ...prev.discovery, meta_description: e.target.value }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 focus:ring-4 focus:ring-sky-400/5 transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Search Keywords (comma separated)</label>
                        <input
                            type="text"
                            placeholder="fast charging, 65w charger, usb-c, gaN technology..."
                            value={newProductData.discovery?.search_keywords?.join(', ') || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                discovery: {
                                    ...prev.discovery,
                                    search_keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 focus:ring-4 focus:ring-sky-400/5 transition-all outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Search Synonyms (comma separated)</label>
                        <input
                            type="text"
                            placeholder="charger, power adapter, fast charger, wall charger..."
                            value={newProductData.discovery?.search_synonyms?.join(', ') || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                discovery: {
                                    ...prev.discovery,
                                    search_synonyms: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 focus:ring-4 focus:ring-sky-400/5 transition-all outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Product Tags (comma separated)</label>
                        <input
                            type="text"
                            placeholder="premium, bestseller, new-arrival, gift-ready..."
                            value={newProductData.discovery?.product_tags?.join(', ') || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                discovery: {
                                    ...prev.discovery,
                                    product_tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 focus:ring-4 focus:ring-sky-400/5 transition-all outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Custom Sort Order</label>
                        <div className="relative">
                            <input
                                type="number"
                                min="0"
                                value={newProductData.discovery?.sort_order || 0}
                                onChange={(e) => setNewProductData(prev => ({
                                    ...prev,
                                    discovery: { ...prev.discovery, sort_order: parseInt(e.target.value) || 0 }
                                }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-sky-400/50 focus:ring-4 focus:ring-sky-400/5 transition-all outline-none"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                            <span>Featured on Homepage</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={newProductData.discovery?.is_featured || false}
                                    onChange={(e) => setNewProductData(prev => ({
                                        ...prev,
                                        discovery: { ...prev.discovery, is_featured: e.target.checked }
                                    }))}
                                />
                                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}